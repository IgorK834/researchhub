package dev.researchhub.source.application;

import dev.researchhub.security.application.UploadInspector;
import dev.researchhub.audit.application.ProductAudit;

import dev.researchhub.processing.application.ProcessingJobService;
import dev.researchhub.shared.error.ApiErrorCode;
import dev.researchhub.shared.error.ApiException;
import dev.researchhub.shared.error.ConflictException;
import dev.researchhub.shared.error.ForbiddenException;
import dev.researchhub.shared.error.PayloadTooLargeException;
import dev.researchhub.shared.error.ResourceNotFoundException;
import dev.researchhub.shared.error.UnsupportedFileTypeException;
import dev.researchhub.source.domain.Source;
import dev.researchhub.source.domain.SourceFilename;
import dev.researchhub.source.domain.SourceStatus;
import dev.researchhub.source.domain.SourceVersion;
import dev.researchhub.source.domain.SourceType;
import dev.researchhub.source.domain.StorageKey;
import dev.researchhub.source.infrastructure.SourceEntity;
import dev.researchhub.source.infrastructure.SourceRepository;
import dev.researchhub.source.infrastructure.SourceVersionEntity;
import dev.researchhub.source.infrastructure.SourceVersionJobRepository;
import dev.researchhub.source.infrastructure.SourceVersionRepository;
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
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
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
 * <p><strong>Upload order.</strong> Bounded bytes are staged and inspected before storage, then the source and its idempotent
 * ingestion job are inserted in one database transaction. Storage is not transactional, so this is the order that
 * fails safe: a failed store leaves no row pointing at nothing, and a failed database transaction is compensated by
 * deleting the stored object. A crash between storage and the transaction can leave an unreferenced object, which is
 * harmless to readers and is what a later reconciliation job would sweep.
 */
@Service
@Profile("local")
@ConditionalOnProperty(prefix = "researchhub.sources.storage", name = "adapter")
public class SourceService {

    /**
     * One detail for every 404 these operations produce: not a member, no such source, and a source in another
     * workspace all read the same.
     */
    public static final String SOURCE_NOT_FOUND = "Source was not found";

    private static final Logger log = LoggerFactory.getLogger(SourceService.class);

    private final SourceRepository sources;
    private final SourceVersionRepository versions;
    private final SourceVersionJobRepository versionJobs;
    private final SourceStorage storage;
    private final SourceLimits limits;
    private final WorkspaceSourceQuota quota;
    private final WorkspaceAuthorizationService authorization;
    private final ProcessingJobService processingJobs;
    private final TransactionTemplate transactions;
    private final Clock clock;
    private final ProductAudit audit;
    private final UploadInspector uploadInspector;

    public SourceService(SourceRepository sources, SourceVersionRepository versions,
                         SourceVersionJobRepository versionJobs, SourceStorage storage, SourceLimits limits,
                         WorkspaceSourceQuota quota, WorkspaceAuthorizationService authorization,
                         ProcessingJobService processingJobs, PlatformTransactionManager transactionManager,
                         Clock clock, ProductAudit audit, UploadInspector uploadInspector) {
        this.sources = sources;
        this.versions = versions;
        this.versionJobs = versionJobs;
        this.storage = storage;
        this.limits = limits;
        this.quota = quota;
        this.authorization = authorization;
        this.processingJobs = processingJobs;
        this.transactions = new TransactionTemplate(transactionManager);
        this.clock = clock; this.audit = audit; this.uploadInspector = uploadInspector;
    }

    /**
     * Stores a file and records it as an {@code UPLOADED} source.
     *
     * <p>In order: the caller must be able to edit the workspace; the file name is cleaned into metadata; the type
     * is recognised from the extension and the declared media type; a declared size over the limit is refused
     * before reading anything; the bytes are streamed into storage through a meter that enforces the limit and
     * computes the SHA-256; the first bytes must look like the type; the workspace quota is asked with the real
     * size; and only then are the source row and its durable ingestion job written atomically.
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
        StoredUpload stored = storeUpload(workspaceId, command);
        Instant now = clock.instant();
        try {
            quota.requireCapacity(workspaceId, stored.sizeBytes());

            Source source = Source.uploaded(workspaceId, stored.filename(), stored.type(), stored.sizeBytes(),
                    stored.key(), stored.sha256(), callerId, now);
            SourceEntity saved = transactions.execute(status -> {
                SourceEntity recorded = sources.saveAndFlush(SourceEntity.fromDomain(source));
                versions.saveAndFlush(SourceVersionEntity.fromDomain(SourceVersion.fromActiveSource(recorded.toDomain())));
                var job = processingJobs.enqueueSourceIngest(workspaceId, recorded.getId());
                versionJobs.bind(job.id(), recorded.getActiveVersionId());
                audit.sourceUploaded(workspaceId, callerId, recorded.getId(), recorded.getActiveVersionId(), stored.sizeBytes());
                return recorded;
            });

            log.info("event=source.uploaded workspaceId={} sourceId={} sourceType={} sizeBytes={} userId={}",
                    workspaceId, saved.getId(), stored.type(), stored.sizeBytes(), callerId);
            return summaryOf(saved.toDomain());
        } catch (RuntimeException notRecorded) {
            discard(stored.key());
            throw notRecorded;
        }
    }

    /** Stores revision bytes as a new immutable version and atomically selects it as active. */
    public SourceSummary replace(UUID workspaceId, UUID callerId, UUID sourceId, UploadSourceCommand command) {
        requireEditor(workspaceId, callerId);
        Source before = requireSource(workspaceId, sourceId);
        if (before.status() != SourceStatus.READY && before.status() != SourceStatus.FAILED) {
            throw new ConflictException("Source processing is already in progress");
        }
        StoredUpload stored = storeUpload(workspaceId, command);
        Instant now = clock.instant();
        try {
            quota.requireCapacity(workspaceId, stored.sizeBytes());
            Source saved = transactions.execute(status -> {
                Source current = sources.findByWorkspaceIdAndIdForUpdate(workspaceId, sourceId)
                        .map(SourceEntity::toDomain)
                        .orElseThrow(() -> new ResourceNotFoundException(SOURCE_NOT_FOUND));
                if (!current.activeVersionId().equals(before.activeVersionId())) {
                    throw new ConflictException("The source was replaced by another request");
                }
                Source replacement = current.replaceWith(UUID.randomUUID(), current.activeVersionNumber() + 1,
                        stored.filename(), stored.type(), stored.sizeBytes(), stored.key(), stored.sha256(), callerId, now);
                versions.saveAndFlush(SourceVersionEntity.fromDomain(SourceVersion.fromActiveSource(replacement)));
                SourceEntity recorded = sources.saveAndFlush(SourceEntity.fromDomain(replacement));
                var job = processingJobs.reprocessSource(workspaceId, sourceId);
                versionJobs.bind(job.id(), replacement.activeVersionId());
                audit.sourceReprocessed(workspaceId, callerId, sourceId, replacement.activeVersionId(), job.id());
                return recorded.toDomain();
            });
            log.info("event=source.replaced workspaceId={} sourceId={} sourceVersionId={} version={} userId={}",
                    workspaceId, sourceId, saved.activeVersionId(), saved.activeVersionNumber(), callerId);
            return summaryOf(saved);
        } catch (RuntimeException notRecorded) {
            discard(stored.key());
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

    @Transactional(readOnly = true)
    public SourceSearchPage search(UUID workspaceId, UUID callerId, String query, String type, String uploader,
                                   String status, String tag, String collection, String pageNumber, String size) {
        requireReader(workspaceId, callerId);
        SourceSearch filters = validatedMetadata(() -> new SourceSearch(query, type, uploader == null || uploader.isBlank() ? null : UUID.fromString(uploader),
                status, tag, collection, Integer.parseInt(pageNumber), Integer.parseInt(size)));
        var page = sources.search(workspaceId, filters.query(), filters.type(),
                filters.uploader() == null ? "" : filters.uploader().toString(), filters.status(), filters.tag(),
                filters.collection(), org.springframework.data.domain.PageRequest.of(filters.page(), filters.size()));
        return new SourceSearchPage(page.getContent().stream().map(entity -> summaryOf(entity.toDomain())).toList(),
                page.getTotalElements(), filters.page(), filters.size(), page.hasNext());
    }

    @Transactional(readOnly = true)
    public SourceLibraryFacets facets(UUID workspaceId, UUID callerId) {
        requireReader(workspaceId, callerId);
        var counts = sources.typeCounts(workspaceId);
        return new SourceLibraryFacets(counts.stream().mapToLong(SourceRepository.TypeCount::getCount).sum(),
                counts.stream().mapToLong(SourceRepository.TypeCount::getReady).sum(),
                counts.stream().collect(java.util.stream.Collectors.toMap(SourceRepository.TypeCount::getType, SourceRepository.TypeCount::getCount)),
                sources.uploaders(workspaceId), sources.tags(workspaceId), sources.collections(workspaceId));
    }

    @Transactional
    public SourceSummary updateBibliography(UUID workspaceId, UUID callerId, UUID sourceId, SourceBibliography metadata) {
        requireEditor(workspaceId, callerId);
        Source current = lockedSource(workspaceId, sourceId);
        Source changed = validatedMetadata(() -> current.withBibliography(metadata.toDomain(), clock.instant()));
        try {
            return summaryOf(sources.saveAndFlush(SourceEntity.fromDomain(changed)).toDomain());
        } catch (org.springframework.dao.DataIntegrityViolationException duplicate) {
            // This operation can only violate the workspace citation-key uniqueness rule after domain validation.
            throw new ConflictException("The citation key is already used by another source in this workspace");
        }
    }

    @Transactional
    public SourceSummary organize(UUID workspaceId, UUID callerId, UUID sourceId, SourceOrganization organization) {
        requireEditor(workspaceId, callerId);
        Source current = lockedSource(workspaceId, sourceId);
        Source changed = validatedMetadata(() -> current.organize(organization.displayName(), organization.tags(),
                organization.collections(), clock.instant()));
        return summaryOf(sources.saveAndFlush(SourceEntity.fromDomain(changed)).toDomain());
    }

    private Source lockedSource(UUID workspaceId, UUID sourceId) {
        return sources.findByWorkspaceIdAndIdForUpdate(workspaceId, sourceId).map(SourceEntity::toDomain)
                .orElseThrow(() -> new ResourceNotFoundException(SOURCE_NOT_FOUND));
    }

    private static <T> T validatedMetadata(java.util.function.Supplier<T> operation) {
        try { return operation.get(); }
        catch (IllegalArgumentException invalid) { throw new ApiException(ApiErrorCode.VALIDATION_FAILED, invalid.getMessage()); }
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

    @Transactional
    public SourceSummary reprocess(UUID workspaceId, UUID callerId, UUID sourceId) {
        requireEditor(workspaceId, callerId);
        Source source = sources.findByWorkspaceIdAndIdForUpdate(workspaceId, sourceId)
                .map(SourceEntity::toDomain).orElseThrow(() -> new ResourceNotFoundException(SOURCE_NOT_FOUND));
        Source processing = source.reprocess(clock.instant());
        SourceVersion version = versions.findForUpdate(workspaceId, sourceId, source.activeVersionId())
                .map(SourceVersionEntity::toDomain)
                .orElseThrow(() -> new IllegalStateException("Active source version is missing"))
                .reprocess(clock.instant());
        versions.saveAndFlush(SourceVersionEntity.fromDomain(version));
        var job = processingJobs.reprocessSource(workspaceId, sourceId);
        versionJobs.bind(job.id(), source.activeVersionId());
        sources.saveAndFlush(SourceEntity.fromDomain(processing));
        audit.sourceReprocessed(workspaceId, callerId, sourceId, source.activeVersionId(), job.id());
        return summaryOf(processing);
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
            try (var scope=dev.researchhub.shared.observability.CorrelationContext.open(dev.researchhub.shared.observability.CorrelationContext.currentOrNew(),java.util.Map.of("sourceId",sourceId.toString()))) {
                log.atError().addKeyValue("event", "source.content_unavailable")
                    .addKeyValue("errorType", failed.getClass().getSimpleName()).log("Source content unavailable");
            }
            throw new UncheckedIOException("The stored content of source " + sourceId + " could not be opened",
                    failed);
        }
    }

    @Transactional(readOnly = true)
    public List<SourceVersionSummary> versions(UUID workspaceId, UUID callerId, UUID sourceId) {
        requireReader(workspaceId, callerId);
        Source source = requireSource(workspaceId, sourceId);
        return versions.findByWorkspaceIdAndSourceIdOrderByVersionNumberDesc(workspaceId, sourceId).stream()
                .map(entity -> versionSummary(entity.toDomain(), source.activeVersionId())).toList();
    }

    @Transactional(readOnly = true)
    public SourceVersionSummary findVersion(UUID workspaceId, UUID callerId, UUID sourceId, UUID versionId) {
        requireReader(workspaceId, callerId);
        Source source = requireSource(workspaceId, sourceId);
        return versionSummary(requireVersion(workspaceId, sourceId, versionId), source.activeVersionId());
    }

    public SourceVersionContent openVersionContent(UUID workspaceId, UUID callerId, UUID sourceId, UUID versionId) {
        requireReader(workspaceId, callerId);
        Source source = transactions.execute(status -> requireSource(workspaceId, sourceId));
        SourceVersion version = transactions.execute(status -> requireVersion(workspaceId, sourceId, versionId));
        try {
            return new SourceVersionContent(versionSummary(version, source.activeVersionId()),
                    storage.open(version.storageKey()));
        } catch (IOException failed) {
            throw new UncheckedIOException("The stored content of source version " + versionId + " could not be opened", failed);
        }
    }

    /** Active version snapshot used by analysis provenance after workspace authorization. */
    @Transactional(readOnly = true)
    public SourceVersionSummary activeVersion(UUID workspaceId, UUID callerId, UUID sourceId) {
        Source source = requireAuthorizedSource(workspaceId, callerId, sourceId);
        return versionSummary(requireVersion(workspaceId, sourceId, source.activeVersionId()), source.activeVersionId());
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

    private StoredUpload storeUpload(UUID workspaceId, UploadSourceCommand command) {
        SourceFilename filename = validated(() -> SourceFilename.of(command.originalFilename()));
        SourceType type = SourceType.resolve(filename, command.declaredMediaType());
        Long declared = command.declaredSizeBytes();
        if (declared != null) {
            if (declared > limits.maxSourceBytes()) throw tooLarge();
            quota.requireCapacity(workspaceId, declared);
        }
        StorageKey key = StorageKey.generate();
        MeteredInputStream metered = new MeteredInputStream(command.content(), limits.maxSourceBytes());
        Path staged = null;
        boolean storeAttempted = false;
        try {
            BufferedInputStream buffered = new BufferedInputStream(metered, SourceType.SIGNATURE_WINDOW_BYTES);
            requireSignature(type, buffered);
            // Random private temporary path; client filename is metadata only. Size is metered while copying.
            staged = Files.createTempFile("researchhub-upload-", ".staged");
            Files.copy(buffered, staged, StandardCopyOption.REPLACE_EXISTING);
            uploadInspector.requireSafe(staged, type.name());
            try (var validatedContent = Files.newInputStream(staged)) {
                storeAttempted = true;
                storage.store(key, validatedContent, type.mediaType());
            }
            return new StoredUpload(filename, type, metered.count(), key, metered.sha256Hex());
        } catch (ContentLimitExceededException exceeded) {
            if (storeAttempted) discard(key);
            throw tooLarge();
        } catch (IOException failed) {
            if (storeAttempted) discard(key);
            throw new UncheckedIOException("Could not store an upload for workspace " + workspaceId, failed);
        } catch (RuntimeException refused) {
            if (storeAttempted) discard(key);
            throw refused;
        } finally {
            if (staged != null) {
                try { Files.deleteIfExists(staged); }
                catch (IOException cleanup) { log.atWarn().addKeyValue("event", "source.staging_cleanup_failed")
                    .addKeyValue("errorType", cleanup.getClass().getSimpleName()).log("Source staging cleanup failed"); }
            }
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
            log.atWarn().addKeyValue("event", "source.orphan_left")
                .addKeyValue("errorType", failed.getClass().getSimpleName()).log("Source storage cleanup failed");
        }
    }

    private Source requireSource(UUID workspaceId, UUID sourceId) {
        return sources.findByWorkspaceIdAndId(workspaceId, sourceId)
                .map(SourceEntity::toDomain)
                .orElseThrow(() -> new ResourceNotFoundException(SOURCE_NOT_FOUND));
    }

    private Source requireAuthorizedSource(UUID workspaceId, UUID callerId, UUID sourceId) {
        requireReader(workspaceId, callerId);
        return requireSource(workspaceId, sourceId);
    }

    private SourceVersion requireVersion(UUID workspaceId, UUID sourceId, UUID versionId) {
        return versions.findByWorkspaceIdAndSourceIdAndId(workspaceId, sourceId, versionId)
                .map(SourceVersionEntity::toDomain)
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
                source.createdAt(), source.updatedAt(), source.activeVersionId(), source.activeVersionNumber(),
                SourceBibliography.from(source.bibliography()), source.tags(), source.collections());
    }

    private static SourceVersionSummary versionSummary(SourceVersion version, UUID activeVersionId) {
        return new SourceVersionSummary(version.id(), version.sourceId(), version.workspaceId(), version.versionNumber(),
                version.originalFilename().value(), version.mediaType(), version.sourceType().name(), version.sizeBytes(),
                version.contentSha256(), version.status().name(), version.failureSummary(), version.uploadedBy(),
                version.createdAt(), version.updatedAt(), version.id().equals(activeVersionId));
    }

    private record StoredUpload(SourceFilename filename, SourceType type, long sizeBytes, StorageKey key, String sha256) {}

}
