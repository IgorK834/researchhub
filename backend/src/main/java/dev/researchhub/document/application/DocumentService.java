package dev.researchhub.document.application;

import dev.researchhub.audit.application.ProductAudit;

import dev.researchhub.document.domain.Document;
import dev.researchhub.document.domain.DocumentContent;
import dev.researchhub.document.domain.DocumentVersion;
import dev.researchhub.document.domain.DocumentVersionReason;
import dev.researchhub.document.domain.StaleRevisionException;
import dev.researchhub.document.infrastructure.DocumentEntity;
import dev.researchhub.document.infrastructure.DocumentRepository;
import dev.researchhub.document.infrastructure.DocumentVersionEntity;
import dev.researchhub.document.infrastructure.DocumentVersionRepository;
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

    /** One detail for a version that does not exist, or belongs to another document. */
    static final String VERSION_NOT_FOUND = "Document version was not found";

    private static final Logger log = LoggerFactory.getLogger(DocumentService.class);

    private final DocumentRepository documents;
    private final DocumentVersionRepository versions;
    private final CheckpointPolicy checkpoints;
    private final WorkspaceAuthorizationService authorization;
    private final Clock clock;
    private final ProductAudit audit;
    private final DocumentProvenance provenance;
    private final List<DocumentSnapshotState> snapshotStates;
    private final dev.researchhub.user.application.UserLookupService users;
    private final List<DocumentReferenceValidator> referenceValidators;
    private final List<DocumentWriteGuard> writeGuards;

    public DocumentService(DocumentRepository documents, DocumentVersionRepository versions,
                           CheckpointPolicy checkpoints, WorkspaceAuthorizationService authorization,
                           Clock clock, List<DocumentReferenceValidator> referenceValidators, List<DocumentWriteGuard> writeGuards, ProductAudit audit, DocumentProvenance provenance, List<DocumentSnapshotState> snapshotStates, dev.researchhub.user.application.UserLookupService users) {
        this.documents = documents;
        this.versions = versions;
        this.checkpoints = checkpoints;
        this.authorization = authorization;
        this.clock = clock; this.audit = audit;
        this.provenance=provenance; this.snapshotStates=List.copyOf(snapshotStates); this.users=users;
        this.referenceValidators = List.copyOf(referenceValidators);
        this.writeGuards = List.copyOf(writeGuards);
    }

    /**
     * Creates a document at revision 1, and records that revision as its first version.
     *
     * <p>{@code @Transactional} so the document and its {@code CREATED} snapshot are written together.
     *
     * @throws ResourceNotFoundException when the caller is not a member of the workspace
     * @throws ForbiddenException        when the caller is a viewer
     * @throws ConflictException         when the workspace is archived
     * @throws ApiException              {@code VALIDATION_FAILED} for an unusable title or content
     */
    @Transactional
    public DocumentDetail create(UUID workspaceId, UUID callerId, CreateDocumentCommand command) {
        requireEditor(workspaceId, callerId);

        referenceValidators.forEach(validator -> validator.validate(workspaceId,callerId,command.content()));

        Instant now = clock.instant();
        Document document = validated(() -> Document.create(
                workspaceId, command.title(), DocumentContent.of(command.content()), callerId, now));

        DocumentEntity saved = documents.saveAndFlush(DocumentEntity.fromDomain(document));
        snapshot(DocumentVersion.snapshotOf(saved.toDomain(), DocumentVersionReason.CREATED, callerId, now));

        provenance.recordChanges(workspaceId,callerId,saved.getId(),saved.getRevision(),saved.getContent(),null);
        audit.documentSaved(workspaceId, callerId, saved.getId(), saved.getRevision(), null, command.content());
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
     * <p>{@code @Transactional}, and the row is read with a lock, so the revision is compared and the new one
     * written without another save landing in between. This is the narrow version of the problem
     * docs/context.md section 9 eventually answers with a CRDT: until then, the second writer is told rather
     * than merged or ignored.
     *
     * <p>The save becomes a version when {@link CheckpointPolicy} says it is a milestone: always for a manual
     * save, and for an autosave once the newest snapshot is old enough. A refused save records nothing.
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
        return reviseWithReason(workspaceId, callerId, documentId, command, null, false);
    }

    /** Explicit AI acceptance: a visible milestone, never selectable through ordinary save requests. */
    @Transactional
    public DocumentDetail reviseFromAi(UUID workspaceId, UUID callerId, UUID documentId, ReviseDocumentCommand command) {
        return reviseWithReason(workspaceId, callerId, documentId, command, DocumentVersionReason.AI_ACCEPTANCE, false);
    }

    /** Public application boundary for revision conflicts; other modules do not import document domain types. */
    public static void requireCurrentRevision(DocumentDetail document, long expected) {
        if (document.summary().revision() != expected) throw new StaleRevisionException(document.summary().revision(), expected);
    }

    private DocumentDetail reviseWithReason(UUID workspaceId, UUID callerId, UUID documentId,
                                            ReviseDocumentCommand command, DocumentVersionReason forcedReason, boolean realtime) {
        requireEditor(workspaceId, callerId);

        Document stored = requireDocumentForUpdate(workspaceId, documentId).toDomain();
        if (!realtime) writeGuards.forEach(guard -> guard.requireLegacyWrite(documentId));
        referenceValidators.forEach(validator -> validator.validate(workspaceId,callerId,command.content()));
        Instant now = clock.instant();

        Document revised = validated(() -> stored.revise(
                command.title(), DocumentContent.of(command.content()), command.expectedRevision(), now));

        DocumentEntity saved = documents.saveAndFlush(DocumentEntity.fromDomain(revised));
        (forcedReason == null ? checkpoints.reasonFor(command.saveKind(), versions.findNewestCreatedAt(documentId), now)
                : java.util.Optional.of(forcedReason))
                .ifPresent(reason -> snapshot(DocumentVersion.snapshotOf(saved.toDomain(), reason, callerId, now)));

        provenance.recordChanges(workspaceId,callerId,saved.getId(),saved.getRevision(),saved.getContent(),stored.content().json());
        audit.documentSaved(workspaceId, callerId, documentId, saved.getRevision(), stored.content().json(), command.content());
        log.info("event=document.revised workspaceId={} documentId={} revision={} saveKind={} userId={}",
                workspaceId, documentId, saved.getRevision(), command.saveKind(), callerId);
        return detailOf(saved);
    }

    /** Internal application boundary: locks the same row as legacy writers during activation/persistence. */
    @Transactional
    public DocumentDetail lockForCollaboration(UUID workspaceId, UUID userId, UUID documentId) {
        return lockForReview(workspaceId, userId, documentId);
    }

    /** Public boundary for review writes. Shares the document lock with saves and refuses archived content. */
    @Transactional
    public DocumentDetail lockForReview(UUID workspaceId, UUID userId, UUID documentId) {
        requireEditor(workspaceId, userId);
        DocumentEntity row = requireDocumentForUpdate(workspaceId, documentId);
        if (row.toDomain().isArchived()) throw new ConflictException("Document is archived");
        return detailOf(row);
    }

    /** Persist a trusted editor projection; authorization and provenance validation still run here. */
    @Transactional
    public DocumentDetail persistCollaboration(UUID workspaceId, UUID userId, UUID documentId,
                                               String title, String content, long revision) {
        return reviseWithReason(workspaceId, userId, documentId,
                new ReviseDocumentCommand(title, content, revision, SaveKind.AUTOSAVE), null, true);
    }

    /** A manual milestone without replacing CRDT content. */
    @Transactional
    public DocumentDetail checkpointCollaboration(UUID workspaceId, UUID userId, UUID documentId) {
        DocumentDetail current = lockForCollaboration(workspaceId, userId, documentId);
        if (versions.findByDocumentIdOrderByRevisionDesc(documentId).stream()
                .noneMatch(version -> version.getRevision() == current.summary().revision())) {
            snapshot(DocumentVersion.snapshotOf(requireDocument(workspaceId, documentId).toDomain(),
                    DocumentVersionReason.MANUAL_SAVE, userId, clock.instant()));
        }
        return current;
    }

    /**
     * The document's versions, newest first, without content. Works on an archived document too: history is
     * part of what members keep reading.
     *
     * @throws ResourceNotFoundException when the caller is not a member, or the document is not in this
     *                                   workspace
     */
    @Transactional(readOnly = true)
    public List<DocumentVersionSummary> listVersions(UUID workspaceId, UUID callerId, UUID documentId) {
        requireReader(workspaceId, callerId);
        requireDocument(workspaceId, documentId);

        return versions.findByDocumentIdOrderByRevisionDesc(documentId).stream()
                .map(row -> new DocumentVersionSummary(row.getId(), row.getRevision(), row.getReason().name(),
                        row.getRestoredFromVersionId(), row.getCreatedBy(), row.getCreatedAt(), row.getName(), row.getActorName(), row.getStateSha256(), row.getCollaborationEpoch(), row.getCollaborationSequence()))
                .toList();
    }

    /**
     * One version with its content.
     *
     * @throws ResourceNotFoundException when the caller is not a member, the document is not in this workspace,
     *                                   or the version does not belong to this document
     */
    @Transactional(readOnly = true)
    public DocumentVersionDetail findVersion(UUID workspaceId, UUID callerId, UUID documentId, UUID versionId) {
        requireReader(workspaceId, callerId);
        requireDocument(workspaceId, documentId);

        DocumentVersionEntity version = requireVersion(documentId, versionId);
        return new DocumentVersionDetail(versionSummaryOf(version), version.getContentFormat().name(),
                version.getContent());
    }

    /**
     * Makes an old version's content the document's next revision.
     *
     * <p>Nothing is deleted or rewound: the document moves forward to a new revision whose text is the old one,
     * with its current title, and that revision is recorded as a {@code RESTORE} version naming the one it came
     * from. Every version in between stays in the history, so a restore can itself be undone by restoring.
     *
     * <p>Same rules as a save, because it is one: {@code EDIT_CONTENT}, the caller's revision must be current,
     * and an archived document or workspace refuses it.
     *
     * @throws ResourceNotFoundException when the caller is not a member, the document is not in this workspace,
     *                                   or the version does not belong to this document
     * @throws ForbiddenException        when the caller is a viewer
     * @throws StaleRevisionException    when {@code expectedRevision} is stale
     * @throws ConflictException         when the workspace or the document is archived
     */
    @Transactional
    public DocumentDetail restore(UUID workspaceId, UUID callerId, UUID documentId, UUID versionId,
                                  long expectedRevision) {
        requireEditor(workspaceId, callerId);

        Document stored = requireDocumentForUpdate(workspaceId, documentId).toDomain();
        DocumentVersion source = requireVersion(documentId, versionId).toDomain();
        referenceValidators.forEach(validator -> validator.validate(workspaceId,callerId,source.content().json()));
        Instant now = clock.instant();

        Document restored = validated(() -> stored.restore(source, expectedRevision, now));

        if (versions.findByDocumentIdOrderByRevisionDesc(documentId).stream().noneMatch(v -> v.getRevision()==stored.revision()))
            snapshot(DocumentVersion.snapshotOf(stored,DocumentVersionReason.MANUAL_SNAPSHOT,callerId,now),"Before restore");
        snapshotStates.forEach(state -> state.restoreState(documentId));
        DocumentEntity saved = documents.saveAndFlush(DocumentEntity.fromDomain(restored));
        snapshot(DocumentVersion.restoreOf(saved.toDomain(), source, callerId, now));

        provenance.recordChanges(workspaceId,callerId,saved.getId(),saved.getRevision(),saved.getContent(),stored.content().json());
        audit.documentSaved(workspaceId, callerId, documentId, saved.getRevision(), stored.content().json(), restored.content().json());
        log.info("event=document.restored workspaceId={} documentId={} revision={} fromVersionId={} userId={}",
                workspaceId, documentId, saved.getRevision(), versionId, callerId);
        return detailOf(saved);
    }

    /** Named immutable snapshot; multiple milestones may refer to the same editor revision. */
    @Transactional
    public DocumentVersionSummary namedSnapshot(UUID workspace,UUID caller,UUID document,long revision,String name) {
        var current=lockForReview(workspace,caller,document);
        requireCurrentRevision(current,revision);
        if (name==null || name.strip().isEmpty() || name.strip().length()>120)
            throw new ApiException(ApiErrorCode.VALIDATION_FAILED,"Name a snapshot using 1–120 characters");
        return versionSummaryOf(snapshot(DocumentVersion.snapshotOf(requireDocument(workspace,document).toDomain(),DocumentVersionReason.MANUAL_SNAPSHOT,caller,clock.instant()),name.strip()));
    }

    /** Internal scheduled checkpoint. Membership is never fabricated for the system actor. */
    @Transactional(propagation=org.springframework.transaction.annotation.Propagation.REQUIRES_NEW)
    public void scheduledSnapshot(UUID workspace,UUID document,Instant dueBefore) {
        if (!authorization.permitsSystemContentMaintenance(workspace)) return;
        var row=requireDocumentForUpdate(workspace,document);
        if (row.toDomain().isArchived()) return;
        var latest=versions.findByDocumentIdOrderByRevisionDesc(document);
        if (latest.stream().anyMatch(v -> v.getRevision()==row.getRevision()) || versions.findNewestCreatedAt(document).filter(time -> time.isAfter(dueBefore)).isPresent()) return;
        snapshot(DocumentVersion.snapshotOf(row.toDomain(),DocumentVersionReason.SCHEDULED_SNAPSHOT,null,clock.instant()),"Automatic snapshot");
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

    /** As {@link #requireDocument}, locking the row until the transaction ends. For revision-checked writes. */
    private DocumentEntity requireDocumentForUpdate(UUID workspaceId, UUID documentId) {
        return documents.findForUpdateByWorkspaceIdAndId(workspaceId, documentId)
                .orElseThrow(() -> new ResourceNotFoundException(DOCUMENT_NOT_FOUND));
    }

    /** The version, but only if it belongs to this document. The document was already scoped by workspace. */
    private DocumentVersionEntity requireVersion(UUID documentId, UUID versionId) {
        return versions.findByDocumentIdAndId(documentId, versionId)
                .orElseThrow(() -> new ResourceNotFoundException(VERSION_NOT_FOUND));
    }

    private void snapshot(DocumentVersion version) { snapshot(version,null); }
    private DocumentVersionEntity snapshot(DocumentVersion version,String name) {
        var entity=DocumentVersionEntity.fromDomain(version);
        var state=snapshotStates.stream().map(provider -> provider.snapshotState(version.documentId())).flatMap(java.util.Optional::stream).findFirst().orElse(null);
        String actor=version.createdBy()==null ? "System" : users.findAllByIds(List.of(version.createdBy())).stream().findFirst().map(user -> user.displayName()).orElse("Former member");
        entity.describeSnapshot(name,actor,state);
        DocumentVersionEntity saved = versions.saveAndFlush(entity);
        log.info("event=document.version.recorded documentId={} revision={} reason={} versionId={}",
                version.documentId(), version.revision(), version.reason(), saved.getId());
        return saved;
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

    private static DocumentVersionSummary versionSummaryOf(DocumentVersionEntity entity) {
        return new DocumentVersionSummary(entity.getId(), entity.getRevision(), entity.getReason().name(),
                entity.getRestoredFromVersionId(), entity.getCreatedBy(), entity.getCreatedAt(), entity.getName(), entity.getActorName(), entity.getStateSha256(), entity.getCollaborationEpoch(), entity.getCollaborationSequence());
    }

    private static DocumentDetail detailOf(DocumentEntity entity) {
        return new DocumentDetail(summaryOf(entity), entity.getContent());
    }

}
