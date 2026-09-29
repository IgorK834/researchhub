package dev.researchhub.source.application;

import dev.researchhub.shared.error.ApiErrorCode;
import dev.researchhub.shared.error.ApiException;
import dev.researchhub.shared.error.ConflictException;
import dev.researchhub.shared.error.ForbiddenException;
import dev.researchhub.shared.error.PayloadTooLargeException;
import dev.researchhub.shared.error.ResourceNotFoundException;
import dev.researchhub.shared.error.UnsupportedFileTypeException;
import dev.researchhub.source.domain.Source;
import dev.researchhub.source.domain.SourceFilename;
import dev.researchhub.source.domain.SourceType;
import dev.researchhub.source.domain.StorageKey;
import dev.researchhub.source.infrastructure.SourceEntity;
import dev.researchhub.source.infrastructure.SourceRepository;
import dev.researchhub.workspace.application.WorkspaceAuthorizationService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;

import java.io.BufferedInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * Adding and reading a workspace's sources.
 *
 * <p>Depends on the {@link SourceStorage} port and nothing cloud-specific. Which adapter answers it is configuration
 * ({@code researchhub.sources.storage.adapter}), and this service only exists once one is configured: with no
 * storage there is nothing to upload into, so the bean is left out rather than failing at the first request.
 *
 * <p>Access follows the workspace, exactly as for documents: reading needs {@code VIEW_CONTENT}, adding needs
 * {@code EDIT_CONTENT} on an active workspace, and a caller who is not a member gets the same 404 as a source that
 * does not exist. A source is always found by its id <em>within</em> the caller's workspace; its storage key is read
 * from that row afterwards and is never an input.
 *
 * <p><strong>Upload order.</strong> The bytes are streamed into storage first, then the row is inserted. Storage is
 * not transactional, so this is the order that fails safe: a failed store leaves no row pointing at nothing, and a
 * failed insert is compensated by deleting the stored object. A crash between the two can leave an unreferenced
 * object, which is harmless to readers and is what a later reconciliation job would sweep.
 */
@Service
@Profile("local")
@ConditionalOnProperty(prefix = "researchhub.sources.storage", name = "adapter")
public class SourceService {

    /**
     * One detail for every 404 these operations produce: not a member, no such source, and a source in another
     * workspace all read the same.
     */
    static final String SOURCE_NOT_FOUND = "Source was not found";

    private static final Logger log = LoggerFactory.getLogger(SourceService.class);

    private final SourceRepository sources;
    private final SourceStorage storage;
    private final SourceLimits limits;
    private final WorkspaceSourceQuota quota;
    private final WorkspaceAuthorizationService authorization;
    private final TransactionTemplate transactions;
    private final Clock clock;

    public SourceService(SourceRepository sources, SourceStorage storage, SourceLimits limits,
                         WorkspaceSourceQuota quota, WorkspaceAuthorizationService authorization,
                         PlatformTransactionManager transactionManager, Clock clock) {
        this.sources = sources;
        this.storage = storage;
        this.limits = limits;
        this.quota = quota;
        this.authorization = authorization;
        this.transactions = new TransactionTemplate(transactionManager);
        this.clock = clock;
    }

    /**
     * Stores a file and records it as an {@code UPLOADED} source.
     *
     * <p>In order: the caller must be able to edit the workspace; the file name is cleaned into metadata; the type
     * is recognised from the extension and the declared media type; a declared size over the limit is refused
     * before reading anything; the bytes are streamed into storage through a meter that enforces the limit and
     * computes the SHA-256; the first bytes must look like the type; the workspace quota is asked with the real
     * size; and only then is the row written.
     *
     * @throws ResourceNotFoundException     when the caller is not a member of the workspace
     * @throws ForbiddenException            when the caller is a viewer
     * @throws ConflictException             when the workspace is archived
     * @throws UnsupportedFileTypeException  when the file is not a supported type, or does not look like one
     * @throws PayloadTooLargeException      when the file is larger than the per-source limit, or the quota refuses
     * @throws ApiException                  {@code VALIDATION_FAILED} for a missing file name or an empty file
     * @throws UncheckedIOException          when storage failed; nothing is recorded
     */
    public SourceSummary upload(UUID workspaceId, UUID callerId, UploadSourceCommand command) {
        requireEditor(workspaceId, callerId);

        SourceFilename filename = validated(() -> SourceFilename.of(command.originalFilename()));
        SourceType type = SourceType.resolve(filename, command.declaredMediaType());

        Long declared = command.declaredSizeBytes();
        if (declared != null) {
            if (declared > limits.maxSourceBytes()) {
                throw tooLarge();
            }
            quota.requireCapacity(workspaceId, declared);
        }

        StorageKey key = StorageKey.generate();
        MeteredInputStream metered = new MeteredInputStream(command.content(), limits.maxSourceBytes());
        try {
            BufferedInputStream buffered = new BufferedInputStream(metered, SourceType.SIGNATURE_WINDOW_BYTES);
            requireSignature(type, buffered);
            storage.store(key, buffered, type.mediaType());
        } catch (ContentLimitExceededException exceeded) {
            discard(key);
            throw tooLarge();
        } catch (IOException failed) {
            discard(key);
            throw new UncheckedIOException("Could not store an upload for workspace " + workspaceId, failed);
        } catch (RuntimeException refused) {
            discard(key);
            throw refused;
        }

        long size = metered.count();
        String sha256 = metered.sha256Hex();
        Instant now = clock.instant();
        try {
            quota.requireCapacity(workspaceId, size);

            Source source = Source.uploaded(workspaceId, filename, type, size, key, sha256, callerId, now);
            SourceEntity saved = transactions.execute(status -> sources.saveAndFlush(SourceEntity.fromDomain(source)));

            log.info("event=source.uploaded workspaceId={} sourceId={} sourceType={} sizeBytes={} userId={}",
                    workspaceId, saved.getId(), type, size, callerId);
            return summaryOf(saved.toDomain());
        } catch (RuntimeException notRecorded) {
            discard(key);
            throw notRecorded;
        }
    }

    /**
     * The workspace's sources, newest first. Works on an archived workspace: members keep reading their material.
     *
     * @throws ResourceNotFoundException when the caller is not a member
     */
    @Transactional(readOnly = true)
    public List<SourceSummary> list(UUID workspaceId, UUID callerId) {
        requireReader(workspaceId, callerId);

        return sources.findByWorkspaceIdOrderByCreatedAtDesc(workspaceId).stream()
                .map(entity -> summaryOf(entity.toDomain()))
                .toList();
    }

    /**
     * One source's metadata.
     *
     * @throws ResourceNotFoundException when the caller is not a member, or the source is not in this workspace
     */
    @Transactional(readOnly = true)
    public SourceSummary findOne(UUID workspaceId, UUID callerId, UUID sourceId) {
        requireReader(workspaceId, callerId);

        return summaryOf(requireSource(workspaceId, sourceId));
    }

    /**
     * One source's metadata and its bytes. The access check runs against the row; the key comes from the row after.
     *
     * @throws ResourceNotFoundException when the caller is not a member, or the source is not in this workspace
     * @throws UncheckedIOException      when the recorded bytes cannot be opened
     */
    public SourceContent openContent(UUID workspaceId, UUID callerId, UUID sourceId) {
        requireReader(workspaceId, callerId);
        Source source = transactions.execute(status -> requireSource(workspaceId, sourceId));

        try {
            return new SourceContent(summaryOf(source), storage.open(source.storageKey()));
        } catch (IOException failed) {
            log.error("event=source.content_unavailable workspaceId={} sourceId={}", workspaceId, sourceId, failed);
            throw new UncheckedIOException("The stored content of source " + sourceId + " could not be opened",
                    failed);
        }
    }

    /**
     * Reads the leading bytes without consuming them, and refuses an empty file or one that does not look like its
     * type — before anything is stored.
     */
    private static void requireSignature(SourceType type, BufferedInputStream content) throws IOException {
        content.mark(SourceType.SIGNATURE_WINDOW_BYTES);
        byte[] head = content.readNBytes(SourceType.SIGNATURE_WINDOW_BYTES);
        content.reset();
        if (head.length == 0) {
            throw new ApiException(ApiErrorCode.VALIDATION_FAILED, "The file is empty");
        }
        if (!type.acceptsLeadingBytes(head)) {
            throw new UnsupportedFileTypeException("The file is named ." + type.extension()
                    + " but its content is not a " + type.name() + " file. " + SourceType.supportedTypesSentence());
        }
    }

    private PayloadTooLargeException tooLarge() {
        return new PayloadTooLargeException("The file is larger than the " + limits.describe()
                + " allowed for one source");
    }

    /** Best-effort removal of bytes that will not be recorded. A failure is logged, not thrown over the cause. */
    private void discard(StorageKey key) {
        try {
            storage.delete(key);
        } catch (IOException | RuntimeException failed) {
            log.warn("event=source.orphan_left storageKey={}", key, failed);
        }
    }

    private Source requireSource(UUID workspaceId, UUID sourceId) {
        return sources.findByWorkspaceIdAndId(workspaceId, sourceId)
                .map(SourceEntity::toDomain)
                .orElseThrow(() -> new ResourceNotFoundException(SOURCE_NOT_FOUND));
    }

    /** As in {@code DocumentService}: a non-member's 404 is rewritten so every 404 here reads the same. */
    private void requireReader(UUID workspaceId, UUID callerId) {
        try {
            authorization.requireContentReader(workspaceId, callerId);
        } catch (ResourceNotFoundException notAMember) {
            throw new ResourceNotFoundException(SOURCE_NOT_FOUND);
        }
    }

    private void requireEditor(UUID workspaceId, UUID callerId) {
        try {
            authorization.requireContentEditor(workspaceId, callerId);
        } catch (ResourceNotFoundException notAMember) {
            throw new ResourceNotFoundException(SOURCE_NOT_FOUND);
        }
    }

    private static <T> T validated(java.util.function.Supplier<T> build) {
        try {
            return build.get();
        } catch (IllegalArgumentException invalid) {
            throw new ApiException(ApiErrorCode.VALIDATION_FAILED, "The file name is not usable: "
                    + invalid.getMessage());
        }
    }

    private static SourceSummary summaryOf(Source source) {
        return new SourceSummary(source.id(), source.workspaceId(), source.originalFilename().value(),
                source.displayName(), source.mediaType(), source.sourceType().name(), source.sizeBytes(),
                source.contentSha256(), source.status().name(), source.failureSummary(), source.uploadedBy(),
                source.createdAt(), source.updatedAt());
    }

}
