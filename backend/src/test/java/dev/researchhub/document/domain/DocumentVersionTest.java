package dev.researchhub.document.domain;

import dev.researchhub.shared.error.ConflictException;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;

/** Snapshot rules, and restoring one, with no database. */
class DocumentVersionTest {

    private static final Instant NOW = Instant.parse("2026-09-24T10:00:00Z");
    private static final Instant LATER = Instant.parse("2026-09-24T11:00:00Z");
    private static final UUID WORKSPACE = UUID.randomUUID();
    private static final UUID AUTHOR = UUID.randomUUID();
    private static final UUID EDITOR = UUID.randomUUID();

    private static final DocumentContent OLD_TEXT = DocumentContent.of(
            "{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\",\"content\":"
                    + "[{\"type\":\"text\",\"text\":\"Old\"}]}]}");
    private static final DocumentContent NEW_TEXT = DocumentContent.of(
            "{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\",\"content\":"
                    + "[{\"type\":\"text\",\"text\":\"New\"}]}]}");

    private static Document persistedAt(long revision, DocumentContent content) {
        return new Document(UUID.randomUUID(), WORKSPACE, "Final report", content,
                DocumentContentFormat.PROSEMIRROR_JSON, revision, AUTHOR, NOW, NOW, null);
    }

    private static DocumentVersion storedVersionOf(Document document) {
        DocumentVersion snapshot = DocumentVersion.snapshotOf(document, DocumentVersionReason.MANUAL_SAVE,
                AUTHOR, NOW);
        return new DocumentVersion(UUID.randomUUID(), snapshot.documentId(), snapshot.revision(),
                snapshot.contentFormat(), snapshot.content(), snapshot.reason(), null, snapshot.createdBy(),
                snapshot.createdAt());
    }

    @Test
    void aSnapshotCopiesTheRevisionAndContentAndRecordsWhoSaved() {
        Document document = persistedAt(4L, NEW_TEXT);

        DocumentVersion version = DocumentVersion.snapshotOf(document, DocumentVersionReason.MANUAL_SAVE,
                EDITOR, LATER);

        assertNull(version.id(), "Hibernate assigns the id on insert");
        assertEquals(document.id(), version.documentId());
        assertEquals(4L, version.revision());
        assertEquals(NEW_TEXT, version.content());
        assertEquals(DocumentContentFormat.PROSEMIRROR_JSON, version.contentFormat());
        assertEquals(EDITOR, version.createdBy(), "The saver, not the document's original author");
        assertEquals(LATER, version.createdAt());
        assertNull(version.restoredFromVersionId());
    }

    @Test
    void anUnsavedDocumentCannotBeSnapshotted() {
        Document unsaved = Document.create(WORKSPACE, "Draft", OLD_TEXT, AUTHOR, NOW);

        assertThrows(IllegalArgumentException.class,
                () -> DocumentVersion.snapshotOf(unsaved, DocumentVersionReason.CREATED, AUTHOR, NOW));
    }

    @Test
    void onlyARestoreNamesTheVersionItCameFrom() {
        Document document = persistedAt(2L, OLD_TEXT);

        assertThrows(IllegalArgumentException.class,
                () -> DocumentVersion.snapshotOf(document, DocumentVersionReason.RESTORE, AUTHOR, NOW),
                "A restore without a source would be history that cannot say where it came from");
        assertThrows(IllegalArgumentException.class,
                () -> new DocumentVersion(null, document.id(), 2L, DocumentContentFormat.PROSEMIRROR_JSON,
                        OLD_TEXT, DocumentVersionReason.MANUAL_SAVE, UUID.randomUUID(), AUTHOR, NOW),
                "and a save must not claim to be one");
    }

    @Test
    void rejectsARevisionBelowTheFirst() {
        assertThrows(IllegalArgumentException.class,
                () -> new DocumentVersion(null, UUID.randomUUID(), 0L, DocumentContentFormat.PROSEMIRROR_JSON,
                        OLD_TEXT, DocumentVersionReason.CREATED, null, AUTHOR, NOW));
    }

    @Test
    void restoringMakesTheOldTextTheNextRevisionAndKeepsTheTitle() {
        Document atTwo = persistedAt(2L, OLD_TEXT);
        DocumentVersion old = storedVersionOf(atTwo);
        Document atFive = new Document(atTwo.id(), WORKSPACE, "Final report v3", NEW_TEXT,
                DocumentContentFormat.PROSEMIRROR_JSON, 5L, AUTHOR, NOW, NOW, null);

        Document restored = atFive.restore(old, 5L, LATER);

        assertEquals(6L, restored.revision(), "Forward to a new revision, never back to an old one");
        assertEquals(OLD_TEXT, restored.content());
        assertEquals("Final report v3", restored.title(), "A version restores the text, not the title");
        assertEquals(LATER, restored.updatedAt());

        DocumentVersion record = DocumentVersion.restoreOf(restored, old, EDITOR, LATER);
        assertEquals(DocumentVersionReason.RESTORE, record.reason());
        assertEquals(old.id(), record.restoredFromVersionId());
        assertEquals(6L, record.revision());
        assertEquals(EDITOR, record.createdBy());
    }

    @Test
    void restoringFollowsTheSameRevisionRuleAsSaving() {
        Document document = persistedAt(3L, NEW_TEXT);
        DocumentVersion old = storedVersionOf(document);

        StaleRevisionException stale = assertThrows(StaleRevisionException.class,
                () -> document.restore(old, 2L, LATER));
        assertEquals(3L, stale.currentRevision());
    }

    @Test
    void anArchivedDocumentCannotBeRestored() {
        Document archived = persistedAt(3L, NEW_TEXT).archive(LATER);
        DocumentVersion old = storedVersionOf(archived);

        ConflictException refused = assertThrows(ConflictException.class, () -> archived.restore(old, 3L, LATER));
        assertFalse(refused instanceof StaleRevisionException, "archived, not stale");
    }

    @Test
    void aVersionOfAnotherDocumentCannotBeRestoredIntoThisOne() {
        DocumentVersion elsewhere = storedVersionOf(persistedAt(2L, OLD_TEXT));

        assertThrows(IllegalArgumentException.class,
                () -> persistedAt(3L, NEW_TEXT).restore(elsewhere, 3L, LATER));
    }

    @Test
    void aRestoreRecordNeedsAStoredSource() {
        Document document = persistedAt(3L, NEW_TEXT);
        DocumentVersion unsaved = DocumentVersion.snapshotOf(document, DocumentVersionReason.MANUAL_SAVE,
                AUTHOR, NOW);

        assertThrows(NullPointerException.class,
                () -> DocumentVersion.restoreOf(document, unsaved, AUTHOR, LATER));
    }

}
