package dev.researchhub.document.infrastructure;

import dev.researchhub.document.domain.Document;
import dev.researchhub.document.domain.DocumentContent;
import dev.researchhub.shared.infrastructure.persistence.PostgresIntegrationTest;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;

import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Locale;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Proves the {@code documents} table and its repository behave as V6 and
 * docs/development/persistence.md promise.
 *
 * <p>The workspace-scoping tests are the important ones. A document id is exactly the sort of value that
 * travels — into a URL, a bookmark, a message — and gets tried against a different workspace. The repository
 * has no method that could answer such a request, and these tests are what say so.
 */
@PostgresIntegrationTest
class DocumentRepositoryIntegrationTest {

    private static final Instant NOW = Instant.parse("2026-09-23T10:15:30Z");

    private static final String DOC_JSON =
            "{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\"}]}";

    @Autowired
    private DocumentRepository documents;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    /**
     * Inserts the {@code users} and {@code workspaces} rows the document foreign keys need, with SQL.
     *
     * <p>Kept local rather than reaching for another module's fixture: what a document needs is an id to point
     * at, which is the same reason the production code stores bare {@link UUID} columns.
     */
    private UUID insertUser(String email) {
        UUID id = UUID.randomUUID();
        jdbcTemplate.update("""
                INSERT INTO users
                    (id, email, normalized_email, password_hash, display_name, status, created_at, updated_at)
                VALUES (?, ?, ?, '{bcrypt}$2a$10$notarealhashnotarealhashnotarealhashnotarealhash',
                        'Test User', 'ACTIVE', ?, ?)
                """, id, email, email.toLowerCase(Locale.ROOT), timestamp(NOW), timestamp(NOW));
        return id;
    }

    private UUID insertWorkspace(String name, UUID createdBy) {
        UUID id = UUID.randomUUID();
        jdbcTemplate.update("""
                INSERT INTO workspaces (id, name, description, created_by, created_at, updated_at)
                VALUES (?, ?, NULL, ?, ?, ?)
                """, id, name, createdBy, timestamp(NOW), timestamp(NOW));
        return id;
    }

    private static OffsetDateTime timestamp(Instant instant) {
        return OffsetDateTime.ofInstant(instant, ZoneOffset.UTC);
    }

    private DocumentEntity insertDocument(UUID workspaceId, String title, UUID author) {
        return documents.saveAndFlush(DocumentEntity.fromDomain(Document.create(
                workspaceId, title, DocumentContent.of(DOC_JSON), author, NOW)));
    }

    @Test
    void savesADocumentAndAssignsAUuid() {
        UUID author = insertUser("ada@example.com");
        UUID workspaceId = insertWorkspace("Electronics Lab", author);

        DocumentEntity saved = insertDocument(workspaceId, "Final report", author);

        assertNotNull(saved.getId(), "Hibernate should assign the UUID on insert");
        assertEquals(workspaceId, saved.getWorkspaceId());
        assertEquals("Final report", saved.getTitle());
        assertEquals(1L, saved.getRevision(), "A new document starts at revision 1");
        assertEquals("PROSEMIRROR_JSON", saved.getContentFormat().name());
        assertEquals(author, saved.getCreatedBy());
        assertTrue(saved.getArchivedAt() == null, "and is active");
    }

    @Test
    void storesTheContentAsJsonRatherThanText() {
        UUID author = insertUser("ada@example.com");
        UUID workspaceId = insertWorkspace("Lab", author);

        UUID documentId = insertDocument(workspaceId, "Report", author).getId();

        assertEquals("object", jdbcTemplate.queryForObject(
                        "SELECT jsonb_typeof(content) FROM documents WHERE id = ?", String.class, documentId),
                "The column is jsonb, so the database knows it holds an object");
        assertEquals("doc", jdbcTemplate.queryForObject(
                        "SELECT content->>'type' FROM documents WHERE id = ?", String.class, documentId),
                "and the structure is queryable rather than an opaque string");
        assertEquals(DOC_JSON, documents.findByWorkspaceIdAndId(workspaceId, documentId)
                        .orElseThrow().getContent(),
                "The round trip returns what was written");
    }

    @Test
    void refusesADocumentWithNoWorkspace() {
        UUID author = insertUser("ada@example.com");

        assertThrows(NullPointerException.class,
                () -> Document.create(null, "Orphan", DocumentContent.of(DOC_JSON), author, NOW),
                "The domain refuses it first");

        DataIntegrityViolationException failure = assertThrows(DataIntegrityViolationException.class,
                () -> insertDocument(UUID.randomUUID(), "Orphan", author),
                "and the foreign key is what proves no row can exist without a real workspace");
        assertTrue(failure.getMessage().contains("fk_documents_workspace"),
                "Expected the workspace foreign key to fail, but was: " + failure.getMessage());
    }

    @Test
    void refusesADocumentWhoseAuthorIsNotARealUser() {
        UUID author = insertUser("ada@example.com");
        UUID workspaceId = insertWorkspace("Lab", author);

        DataIntegrityViolationException failure = assertThrows(DataIntegrityViolationException.class,
                () -> insertDocument(workspaceId, "Ghostwritten", UUID.randomUUID()));

        assertTrue(failure.getMessage().contains("fk_documents_created_by"),
                "Expected the author foreign key to fail, but was: " + failure.getMessage());
    }

    /** The acceptance property of RH-060, at the level that makes it structural rather than remembered. */
    @Test
    void aQueryForOneWorkspaceNeverReturnsAnotherWorkspacesDocument() {
        UUID author = insertUser("ada@example.com");
        UUID workspaceA = insertWorkspace("Workspace A", author);
        UUID workspaceB = insertWorkspace("Workspace B", author);
        UUID documentInB = insertDocument(workspaceB, "B's report", author).getId();

        assertTrue(documents.findByWorkspaceIdAndId(workspaceA, documentInB).isEmpty(),
                "B's document, asked for with A's id, is simply not there");
        assertTrue(documents.findByWorkspaceIdAndId(workspaceB, documentInB).isPresent(),
                "though it is there for its own workspace");
        assertEquals(List.of(), documents.findByWorkspaceIdAndArchivedAtIsNullOrderByUpdatedAtDesc(workspaceA),
                "and A's list is empty rather than containing it");
    }

    @Test
    void listsActiveDocumentsMostRecentlyUpdatedFirst() {
        UUID author = insertUser("ada@example.com");
        UUID workspaceId = insertWorkspace("Lab", author);
        DocumentEntity older = insertDocument(workspaceId, "Older", author);
        DocumentEntity newer = documents.saveAndFlush(DocumentEntity.fromDomain(Document.create(
                workspaceId, "Newer", DocumentContent.of(DOC_JSON), author, NOW.plusSeconds(60))));

        List<String> titles = documents
                .findByWorkspaceIdAndArchivedAtIsNullOrderByUpdatedAtDesc(workspaceId).stream()
                .map(DocumentEntity::getTitle)
                .toList();

        assertEquals(List.of("Newer", "Older"), titles);
        assertNotNull(older.getId());
        assertNotNull(newer.getId());
    }

    @Test
    void leavesArchivedDocumentsOutOfTheListButKeepsThemReadable() {
        UUID author = insertUser("ada@example.com");
        UUID workspaceId = insertWorkspace("Lab", author);
        Document active = insertDocument(workspaceId, "Active", author).toDomain();
        Document toArchive = insertDocument(workspaceId, "Retired", author).toDomain();

        UUID archivedId = documents.saveAndFlush(DocumentEntity.fromDomain(
                toArchive.archive(NOW.plusSeconds(60)))).getId();

        assertEquals(List.of("Active"), documents
                        .findByWorkspaceIdAndArchivedAtIsNullOrderByUpdatedAtDesc(workspaceId).stream()
                        .map(DocumentEntity::getTitle)
                        .toList(),
                "The database does the filtering, so an archived document never reaches the list");

        DocumentEntity stillThere = documents.findByWorkspaceIdAndId(workspaceId, archivedId).orElseThrow();
        assertNotNull(stillThere.getArchivedAt());
        assertEquals(DOC_JSON, stillThere.getContent(),
                "Archiving hides a document; the text it holds is not destroyed");
        assertNotNull(active.id());
    }

    /**
     * Each value gets its own invocation, and so its own transaction: a constraint violation aborts the
     * PostgreSQL transaction, so several failing inserts in one test method would report the abort rather than
     * the constraint.
     */
    @ParameterizedTest
    @ValueSource(strings = {"[1,2,3]", "\"just a string\"", "42", "null", "true"})
    void refusesContentThatIsNotAJsonObject(String notAnObject) {
        UUID author = insertUser("ada@example.com");
        UUID workspaceId = insertWorkspace("Lab", author);

        DataIntegrityViolationException failure = assertThrows(DataIntegrityViolationException.class,
                () -> insertRawContent(workspaceId, author, notAnObject),
                notAnObject + " is valid JSON but is not a document");

        assertTrue(failure.getMessage().contains("ck_documents_content_is_object"),
                "Expected the object check to fail for " + notAnObject + ", but was: "
                        + failure.getMessage());
    }

    @Test
    void refusesContentLargerThanTheDocumentedLimit() {
        UUID author = insertUser("ada@example.com");
        UUID workspaceId = insertWorkspace("Lab", author);
        String oversize = "{\"text\":\"" + "a".repeat(1_000_001) + "\"}";

        DataIntegrityViolationException failure = assertThrows(DataIntegrityViolationException.class,
                () -> insertRawContent(workspaceId, author, oversize));

        assertTrue(failure.getMessage().contains("ck_documents_content_size"),
                "Expected the size check to fail, but was: " + failure.getMessage());
    }

    @Test
    void refusesAnUnknownContentFormat() {
        UUID author = insertUser("ada@example.com");
        UUID workspaceId = insertWorkspace("Lab", author);

        DataIntegrityViolationException failure = assertThrows(DataIntegrityViolationException.class,
                () -> jdbcTemplate.update("""
                        INSERT INTO documents
                            (id, workspace_id, title, content_format, content, revision, created_by,
                             created_at, updated_at)
                        VALUES (?, ?, 'Report', 'HTML', CAST(? AS jsonb), 1, ?, ?, ?)
                        """, UUID.randomUUID(), workspaceId, DOC_JSON, author,
                        timestamp(NOW), timestamp(NOW)),
                "HTML is not a stored format: a format that can carry markup makes every renderer a sanitizer");

        assertTrue(failure.getMessage().contains("ck_documents_content_format"),
                "Expected the format check to fail, but was: " + failure.getMessage());
    }

    @Test
    void refusesABlankTitleEvenWhenTheDomainIsBypassed() {
        UUID author = insertUser("ada@example.com");
        UUID workspaceId = insertWorkspace("Lab", author);

        DataIntegrityViolationException failure = assertThrows(DataIntegrityViolationException.class,
                () -> jdbcTemplate.update("""
                        INSERT INTO documents
                            (id, workspace_id, title, content_format, content, revision, created_by,
                             created_at, updated_at)
                        VALUES (?, ?, '   ', 'PROSEMIRROR_JSON', CAST(? AS jsonb), 1, ?, ?, ?)
                        """, UUID.randomUUID(), workspaceId, DOC_JSON, author,
                        timestamp(NOW), timestamp(NOW)));

        assertTrue(failure.getMessage().contains("ck_documents_title_not_blank"),
                "Expected the not-blank check to fail, but was: " + failure.getMessage());
    }

    @Test
    void refusesARevisionBelowOne() {
        UUID author = insertUser("ada@example.com");
        UUID workspaceId = insertWorkspace("Lab", author);

        DataIntegrityViolationException failure = assertThrows(DataIntegrityViolationException.class,
                () -> jdbcTemplate.update("""
                        INSERT INTO documents
                            (id, workspace_id, title, content_format, content, revision, created_by,
                             created_at, updated_at)
                        VALUES (?, ?, 'Report', 'PROSEMIRROR_JSON', CAST(? AS jsonb), 0, ?, ?, ?)
                        """, UUID.randomUUID(), workspaceId, DOC_JSON, author,
                        timestamp(NOW), timestamp(NOW)));

        assertTrue(failure.getMessage().contains("ck_documents_revision_positive"),
                "Expected the revision check to fail, but was: " + failure.getMessage());
    }

    @Test
    void duplicatesNoUserOrWorkspaceColumnOntoTheDocument() {
        Integer copiedColumns = jdbcTemplate.queryForObject("""
                SELECT count(*) FROM information_schema.columns
                WHERE table_name = 'documents'
                  AND column_name IN ('email', 'password_hash', 'display_name', 'workspace_name', 'role')
                """, Integer.class);

        assertEquals(0, copiedColumns,
                "A document references a workspace and a user by id, and copies nothing from either");
    }

    private void insertRawContent(UUID workspaceId, UUID author, String rawJson) {
        jdbcTemplate.update("""
                INSERT INTO documents
                    (id, workspace_id, title, content_format, content, revision, created_by,
                     created_at, updated_at)
                VALUES (?, ?, 'Report', 'PROSEMIRROR_JSON', CAST(? AS jsonb), 1, ?, ?, ?)
                """, UUID.randomUUID(), workspaceId, rawJson, author, timestamp(NOW), timestamp(NOW));
    }

}
