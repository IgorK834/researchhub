package dev.researchhub.document.domain;

import dev.researchhub.shared.error.ApiErrorCode;
import dev.researchhub.shared.error.ConflictException;
import dev.researchhub.shared.validation.FieldLengths;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Document rules, with no database and no HTTP.
 *
 * <p>The revision check is the interesting one. It is a rule about what a legal change <em>is</em>, so it lives
 * here and holds for every caller — not in the controller, where a second write path could skip it.
 */
class DocumentTest {

    private static final Instant NOW = Instant.parse("2026-09-23T10:15:30Z");
    private static final Instant LATER = Instant.parse("2026-09-24T09:00:00Z");
    private static final Instant MUCH_LATER = Instant.parse("2026-10-01T09:00:00Z");

    private static final UUID WORKSPACE = UUID.randomUUID();
    private static final UUID AUTHOR = UUID.randomUUID();

    private static final DocumentContent CONTENT = DocumentContent.of(
            "{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\"}]}");
    private static final DocumentContent NEW_CONTENT = DocumentContent.of(
            "{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\",\"content\":"
                    + "[{\"type\":\"text\",\"text\":\"Measurements\"}]}]}");

    private static Document created(String title) {
        return Document.create(WORKSPACE, title, CONTENT, AUTHOR, NOW);
    }

    /** A saved document at revision 3: the state a revision check is interesting against. */
    private static Document persisted() {
        return new Document(UUID.randomUUID(), WORKSPACE, "Final report", CONTENT,
                DocumentContentFormat.PROSEMIRROR_JSON, 3L, AUTHOR, NOW, NOW, null);
    }

    @Test
    void createsAnActiveDocumentAtTheFirstRevision() {
        Document document = created("Final report");

        assertNull(document.id(), "Hibernate assigns the id on insert");
        assertFalse(document.isPersisted());
        assertEquals(1L, document.revision());
        assertEquals(Document.FIRST_REVISION, document.revision());
        assertEquals(WORKSPACE, document.workspaceId());
        assertEquals(AUTHOR, document.createdBy());
        assertEquals(DocumentContentFormat.PROSEMIRROR_JSON, document.contentFormat(),
                "The format is decided here, not requested");
        assertFalse(document.isArchived());
        assertEquals(NOW, document.updatedAt());
    }

    @Test
    void requiresAWorkspace() {
        assertThrows(NullPointerException.class,
                () -> Document.create(null, "Final report", CONTENT, AUTHOR, NOW),
                "A document with no workspace would be a document with no access rule");
    }

    @Test
    void requiresAnAuthorAndContent() {
        assertThrows(NullPointerException.class,
                () -> Document.create(WORKSPACE, "Final report", CONTENT, null, NOW));
        assertThrows(NullPointerException.class,
                () -> Document.create(WORKSPACE, "Final report", null, AUTHOR, NOW));
    }

    @Test
    void trimsTheTitle() {
        assertEquals("Final report", created("  Final report  ").title());
    }

    @Test
    void rejectsABlankTitle() {
        assertThrows(IllegalArgumentException.class, () -> created(null));
        assertThrows(IllegalArgumentException.class, () -> created(""));
        assertThrows(IllegalArgumentException.class, () -> created("   "),
                "A whitespace-only title would be invisible in the document list");
    }

    @Test
    void rejectsATitleOverTheSharedLimit() {
        String longest = "t".repeat(FieldLengths.TITLE_MAX);

        assertEquals(FieldLengths.TITLE_MAX, created(longest).title().length(),
                "The documented maximum is accepted, and matches the documents.title column");
        assertThrows(IllegalArgumentException.class, () -> created(longest + "t"));
    }

    @Test
    void rejectsARevisionBelowTheFirstOne() {
        assertThrows(IllegalArgumentException.class,
                () -> new Document(UUID.randomUUID(), WORKSPACE, "Report", CONTENT,
                        DocumentContentFormat.PROSEMIRROR_JSON, 0L, AUTHOR, NOW, NOW, null));
    }

    // --- revising ---

    @Test
    void revisingWithTheCurrentRevisionAdvancesIt() {
        Document document = persisted();

        Document revised = document.revise("Final report v2", NEW_CONTENT, 3L, LATER);

        assertEquals(4L, revised.revision(), "The saved revision is the next one");
        assertEquals("Final report v2", revised.title());
        assertEquals(NEW_CONTENT, revised.content());
        assertEquals(LATER, revised.updatedAt());
        assertEquals(NOW, revised.createdAt(), "createdAt is history and does not move");
        assertEquals(document.createdBy(), revised.createdBy(),
                "and the author of the document does not change when somebody else edits it");
    }

    @Test
    void revisingWithAStaleRevisionIsRefused() {
        Document document = persisted();

        StaleRevisionException stale = assertThrows(StaleRevisionException.class,
                () -> document.revise("Mine", NEW_CONTENT, 2L, LATER),
                "Somebody saved in between, and overwriting them is the one unrecoverable outcome");

        assertEquals(ApiErrorCode.CONFLICT, stale.code());
        assertEquals(3L, stale.currentRevision());
        assertEquals(Map.of("currentRevision", 3L), stale.properties(),
                "The stored revision travels as a structured member, and nothing else does — no content");
        assertTrue(stale.getMessage().contains("revision 3"),
                "The message should name the current revision, but was: " + stale.getMessage());
        assertTrue(stale.getMessage().contains("revision 2"), "and the caller's");
    }

    @Test
    void revisingWithARevisionFromTheFutureIsAlsoRefused() {
        assertThrows(ConflictException.class, () -> persisted().revise("Mine", NEW_CONTENT, 9L, LATER),
                "A revision the server never issued is not current either");
    }

    @Test
    void aRefusedRevisionLeavesTheOriginalUntouched() {
        Document document = persisted();

        assertThrows(ConflictException.class, () -> document.revise("Mine", NEW_CONTENT, 2L, LATER));

        assertEquals("Final report", document.title());
        assertEquals(3L, document.revision());
        assertEquals(CONTENT, document.content());
    }

    @Test
    void revisingStillEnforcesTheTitleRules() {
        Document document = persisted();

        assertThrows(IllegalArgumentException.class, () -> document.revise("   ", NEW_CONTENT, 3L, LATER),
                "A revision cannot do what a create is not allowed to do");
        assertThrows(IllegalArgumentException.class, () -> document.revise(
                "t".repeat(FieldLengths.TITLE_MAX + 1), NEW_CONTENT, 3L, LATER));
    }

    // --- archiving ---

    @Test
    void archivingKeepsTheTextAndTheRevision() {
        Document archived = persisted().archive(LATER);

        assertTrue(archived.isArchived());
        assertEquals(LATER, archived.archivedAt());
        assertEquals(CONTENT, archived.content(), "Archiving hides a document, it does not empty it");
        assertEquals("Final report", archived.title());
        assertEquals(3L, archived.revision(), "and it is not a revision of the document");
    }

    @Test
    void archivingTwiceKeepsTheFirstTimestamp() {
        Document archived = persisted().archive(LATER);

        Document again = archived.archive(MUCH_LATER);

        assertEquals(LATER, again.archivedAt(),
                "A retried archive must not rewrite when it happened");
        assertEquals(archived, again);
    }

    @Test
    void anArchivedDocumentCannotBeRevised() {
        Document archived = persisted().archive(LATER);

        ConflictException refused = assertThrows(ConflictException.class,
                () -> archived.revise("Final report v2", NEW_CONTENT, 3L, MUCH_LATER));

        assertEquals(ApiErrorCode.CONFLICT, refused.code());
        assertTrue(refused.getMessage().contains("archived"),
                "The message should say why, but was: " + refused.getMessage());
        assertFalse(refused instanceof StaleRevisionException,
                "An archived document is not a newer revision to reload");
        assertTrue(refused.properties().isEmpty(), "so it carries no currentRevision");
    }

    /**
     * The archived check runs before the revision check, so a caller holding a stale copy of an archived
     * document is told the useful thing rather than being sent to reload a document that is closed anyway.
     */
    @Test
    void anArchivedDocumentReportsBeingArchivedRatherThanAConflictingRevision() {
        Document archived = persisted().archive(LATER);

        ConflictException refused = assertThrows(ConflictException.class,
                () -> archived.revise("Mine", NEW_CONTENT, 1L, MUCH_LATER));

        assertTrue(refused.getMessage().contains("archived"), refused.getMessage());
    }

}
