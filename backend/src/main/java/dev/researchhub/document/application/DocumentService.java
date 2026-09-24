package dev.researchhub.document.application;

import dev.researchhub.document.domain.Document;
import dev.researchhub.document.domain.DocumentContent;
import dev.researchhub.document.domain.StaleRevisionException;
import dev.researchhub.document.infrastructure.DocumentEntity;
import dev.researchhub.document.infrastructure.DocumentRepository;
import dev.researchhub.shared.error.ApiErrorCode;
import dev.researchhub.shared.error.ApiException;
import dev.researchhub.shared.error.ConflictException;
import dev.researchhub.shared.error.ForbiddenException;
import dev.researchhub.shared.error.ResourceNotFoundException;
import dev.researchhub.workspace.application.WorkspaceAuthorizationService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * Reading and writing workspace documents.
 *
 * <p>Access is not decided here. Every method asks {@link WorkspaceAuthorizationService} first, through the two
 * {@code void} guards that keep this module from importing the workspace role table at all: reading needs
 * {@code VIEW_CONTENT}, writing needs {@code EDIT_CONTENT} and an workspace that still accepts changes.
 *
 * <p>Every repository call is scoped by workspace id, so a document belonging to another workspace is not
 * something this class has to remember to reject — there is no query that would find it.
 *
 * <p>Active on the {@code local} profile only, like the workspace services, because it needs a repository.
 */
@Service
@Profile("local")
public class DocumentService {

    /**
     * One detail for every 404 these routes can produce.
     *
     * <p>A caller who is not a member of the workspace, a document id that does not exist, and a document id
     * that belongs to somebody else's workspace all read identically. Distinguishing them would leak the thing
     * the workspace boundary exists to hide — that the other workspace, or the other document, is there at all.
     */
    static final String DOCUMENT_NOT_FOUND = "Document was not found";

    private static final Logger log = LoggerFactory.getLogger(DocumentService.class);

    private final DocumentRepository documents;
    private final WorkspaceAuthorizationService authorization;
    private final Clock clock;

    public DocumentService(DocumentRepository documents, WorkspaceAuthorizationService authorization,
                           Clock clock) {
        this.documents = documents;
        this.authorization = authorization;
        this.clock = clock;
    }

    /**
     * Creates a document at revision 1.
     *
     * <p>Not {@code @Transactional}: one insert, already atomic.
     *
     * @throws ResourceNotFoundException when the caller is not a member of the workspace
     * @throws ForbiddenException        when the caller is a viewer
     * @throws ConflictException         when the workspace is archived
     * @throws ApiException              {@code VALIDATION_FAILED} for an unusable title or content
     */
    public DocumentDetail create(UUID workspaceId, UUID callerId, CreateDocumentCommand command) {
        requireEditor(workspaceId, callerId);

        Instant now = clock.instant();
        Document document = validated(() -> Document.create(
                workspaceId, command.title(), DocumentContent.of(command.content()), callerId, now));

        DocumentEntity saved = documents.saveAndFlush(DocumentEntity.fromDomain(document));

        log.info("event=document.created workspaceId={} documentId={} userId={}",
                workspaceId, saved.getId(), callerId);
        return detailOf(saved);
    }

    /**
     * The active documents in the workspace, most recently updated first.
     *
     * <p>Summaries only — no content. Works on an archived workspace, because members keep reading what they
     * wrote.
     *
     * @throws ResourceNotFoundException when the caller is not a member
     */
    @Transactional(readOnly = true)
    public List<DocumentSummary> list(UUID workspaceId, UUID callerId) {
        requireReader(workspaceId, callerId);

        return documents.findByWorkspaceIdAndArchivedAtIsNullOrderByUpdatedAtDesc(workspaceId).stream()
                .map(DocumentService::summaryOf)
                .toList();
    }

    /**
     * One document with its content, including an archived one.
     *
     * @throws ResourceNotFoundException when the caller is not a member, the document does not exist, or it
     *                                   belongs to a different workspace. All three read the same.
     */
    @Transactional(readOnly = true)
    public DocumentDetail findOne(UUID workspaceId, UUID callerId, UUID documentId) {
        requireReader(workspaceId, callerId);

        return detailOf(requireDocument(workspaceId, documentId));
    }

    /**
     * Saves the next revision, if the caller's copy is current.
     *
     * <p>{@code @Transactional} so the revision is compared and the new one written without another save
     * landing in between. This is the narrow version of the problem docs/context.md section 9 eventually
     * answers with a CRDT: until then, the second writer is told rather than merged or ignored.
     *
     * @throws ResourceNotFoundException when the caller is not a member, or the document is not in this
     *                                   workspace
     * @throws ForbiddenException        when the caller is a viewer
     * @throws StaleRevisionException    when the caller's revision is stale; the 409 carries
     *                                   {@code currentRevision}
     * @throws ConflictException         when the workspace is archived or the document is archived
     * @throws ApiException              {@code VALIDATION_FAILED} for an unusable title or content
     */
    @Transactional
    public DocumentDetail revise(UUID workspaceId, UUID callerId, UUID documentId,
                                 ReviseDocumentCommand command) {
        requireEditor(workspaceId, callerId);

        Document stored = requireDocument(workspaceId, documentId).toDomain();
        Instant now = clock.instant();

        Document revised = validated(() -> stored.revise(
                command.title(), DocumentContent.of(command.content()), command.expectedRevision(), now));

        DocumentEntity saved = documents.saveAndFlush(DocumentEntity.fromDomain(revised));

        log.info("event=document.revised workspaceId={} documentId={} revision={} userId={}",
                workspaceId, documentId, saved.getRevision(), callerId);
        return detailOf(saved);
    }

    /**
     * Archives a document. Idempotent, and writes nothing if it is archived already.
     *
     * <p>Soft: the row and its text stay, the document keeps its revision, and it remains readable by id. It
     * simply leaves {@link #list}. Nothing in this module deletes a row — the prose is the product, and a
     * delete would be the one operation nobody can undo.
     *
     * @throws ResourceNotFoundException when the caller is not a member, or the document is not in this
     *                                   workspace
     * @throws ForbiddenException        when the caller is a viewer
     * @throws ConflictException         when the workspace is archived
     */
    @Transactional
    public void archive(UUID workspaceId, UUID callerId, UUID documentId) {
        requireEditor(workspaceId, callerId);

        Document stored = requireDocument(workspaceId, documentId).toDomain();
        if (stored.isArchived()) {
            return;
        }

        documents.saveAndFlush(DocumentEntity.fromDomain(stored.archive(clock.instant())));

        log.info("event=document.archived workspaceId={} documentId={} userId={}",
                workspaceId, documentId, callerId);
    }

    /**
     * The document, scoped to the workspace in the path.
     *
     * <p>This single query is what makes cross-workspace substitution a non-event: a document id from another
     * workspace matches nothing, so it is answered exactly like an id that was never issued.
     */
    private DocumentEntity requireDocument(UUID workspaceId, UUID documentId) {
        return documents.findByWorkspaceIdAndId(workspaceId, documentId)
                .orElseThrow(() -> {
                    log.debug("event=document.not_found workspaceId={} documentId={}",
                            workspaceId, documentId);
                    return new ResourceNotFoundException(DOCUMENT_NOT_FOUND);
                });
    }

    /**
     * Asserts the caller may read this workspace's content, reporting a failure as a document 404.
     *
     * <p>The workspace's own "not found" message is rewritten to the document one so that every 404 from a
     * document route reads the same. Without that, a caller could tell "I am not in that workspace" from
     * "that document does not exist", and the first answer confirms the workspace is real.
     */
    private void requireReader(UUID workspaceId, UUID callerId) {
        try {
            authorization.requireContentReader(workspaceId, callerId);
        } catch (ResourceNotFoundException notAMember) {
            throw new ResourceNotFoundException(DOCUMENT_NOT_FOUND);
        }
    }

    /** As {@link #requireReader}, for a write. Also refuses a viewer, and an archived workspace. */
    private void requireEditor(UUID workspaceId, UUID callerId) {
        try {
            authorization.requireContentEditor(workspaceId, callerId);
        } catch (ResourceNotFoundException notAMember) {
            throw new ResourceNotFoundException(DOCUMENT_NOT_FOUND);
        }
    }

    /**
     * Runs a domain factory, turning its rejection of an unusable value into {@code VALIDATION_FAILED}.
     *
     * <p>Only {@link IllegalArgumentException} is translated. A {@link ConflictException} — a stale revision or
     * an archived document — passes through as the 409 it is.
     */
    private static Document validated(java.util.function.Supplier<Document> build) {
        try {
            return build.get();
        } catch (IllegalArgumentException invalid) {
            // The domain messages are written for a person and name no internal detail.
            throw new ApiException(ApiErrorCode.VALIDATION_FAILED, invalid.getMessage());
        }
    }

    private static DocumentSummary summaryOf(DocumentEntity entity) {
        return new DocumentSummary(
                entity.getId(),
                entity.getTitle(),
                entity.getContentFormat().name(),
                entity.getRevision(),
                entity.getCreatedAt(),
                entity.getUpdatedAt(),
                entity.getArchivedAt());
    }

    private static DocumentDetail detailOf(DocumentEntity entity) {
        return new DocumentDetail(summaryOf(entity), entity.getContent());
    }

}
