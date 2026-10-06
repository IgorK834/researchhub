package dev.researchhub.document.domain;

import java.time.Instant;
import java.util.Objects;
import java.util.UUID;

/**
 * An immutable snapshot of one revision of a document: a restore point.
 *
 * <p>Not every revision has one. Snapshots are taken at milestones ({@link DocumentVersionReason}), so an
 * autosaving editor does not leave a row per keystroke. Once written, a snapshot is never changed or removed —
 * the table refuses both — and restoring one creates a new revision rather than rewinding anything.
 *
 * <p>Title is not part of a snapshot. A version is a restore point for the text, and restoring it keeps the
 * document's current title.
 *
 * @param restoredFromVersionId for {@link DocumentVersionReason#RESTORE} only, the snapshot whose content was
 *                              restored; {@code null} otherwise
 * @param createdBy             who produced this revision — the saver or the restorer
 */
public record DocumentVersion(
        UUID id,
        UUID documentId,
        long revision,
        DocumentContentFormat contentFormat,
        DocumentContent content,
        DocumentVersionReason reason,
        UUID restoredFromVersionId,
        UUID createdBy,
        Instant createdAt
) {

    public DocumentVersion {
        Objects.requireNonNull(documentId, "documentId must not be null");
        Objects.requireNonNull(contentFormat, "contentFormat must not be null");
        Objects.requireNonNull(content, "content must not be null");
        Objects.requireNonNull(reason, "reason must not be null");
        if (reason != DocumentVersionReason.SCHEDULED_SNAPSHOT) Objects.requireNonNull(createdBy, "createdBy must not be null");
        Objects.requireNonNull(createdAt, "createdAt must not be null");
        if (revision < Document.FIRST_REVISION) {
            throw new IllegalArgumentException("a version's revision must be at least " + Document.FIRST_REVISION);
        }
        if ((reason == DocumentVersionReason.RESTORE) != (restoredFromVersionId != null)) {
            throw new IllegalArgumentException(
                    "a restore names the version it came from, and nothing else may name one");
        }
    }

    /**
     * Snapshots the document as it now stands. Not for {@link DocumentVersionReason#RESTORE}; see
     * {@link #restoreOf}.
     *
     * @param createdBy the caller who produced this revision, never the document's original author by default
     */
    public static DocumentVersion snapshotOf(Document document, DocumentVersionReason reason, UUID createdBy,
                                             Instant now) {
        return new DocumentVersion(null, requirePersisted(document), document.revision(),
                document.contentFormat(), document.content(), reason, null, createdBy, now);
    }

    /** Snapshots the revision a restore produced, recording which version it restored. */
    public static DocumentVersion restoreOf(Document document, DocumentVersion restored, UUID createdBy,
                                            Instant now) {
        Objects.requireNonNull(restored.id(), "the restored version must be persisted");
        return new DocumentVersion(null, requirePersisted(document), document.revision(),
                document.contentFormat(), document.content(), DocumentVersionReason.RESTORE, restored.id(),
                createdBy, now);
    }

    private static UUID requirePersisted(Document document) {
        if (!document.isPersisted()) {
            throw new IllegalArgumentException("only a saved document can be snapshotted");
        }
        return document.id();
    }

}
