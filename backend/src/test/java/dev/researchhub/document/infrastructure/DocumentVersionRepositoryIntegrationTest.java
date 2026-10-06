package dev.researchhub.document.infrastructure;

import dev.researchhub.document.domain.Document;
import dev.researchhub.document.domain.DocumentContent;
import dev.researchhub.document.domain.DocumentVersion;
import dev.researchhub.document.domain.DocumentVersionReason;
import dev.researchhub.shared.infrastructure.persistence.PostgresIntegrationTest;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;

import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Proves {@code document_versions} behaves as V7 promises: snapshots are scoped to their document, listed
 * without content, and cannot be changed or removed by anybody — the application or a hand-written statement.
 */
@PostgresIntegrationTest
class DocumentVersionRepositoryIntegrationTest {

    private static final Instant NOW = Instant.parse("2026-09-24T10:00:00Z");
    private static final String DOC_JSON = "{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\"}]}";

    @Autowired
    private DocumentRepository documents;

    @Autowired
    private DocumentVersionRepository versions;

    @Autowired
    private JdbcTemplate jdbcTemplate;

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

    private UUID insertWorkspace(UUID createdBy) {
        UUID id = UUID.randomUUID();
        jdbcTemplate.update("""
                INSERT INTO workspaces (id, name, description, created_by, created_at, updated_at)
                VALUES (?, 'Lab', NULL, ?, ?, ?)
                """, id, createdBy, timestamp(NOW), timestamp(NOW));
        return id;
    }

    private static OffsetDateTime timestamp(Instant instant) {
        return OffsetDateTime.ofInstant(instant, ZoneOffset.UTC);
    }

    private Document insertDocument(UUID author) {
        UUID workspaceId = insertWorkspace(author);
        return documents.saveAndFlush(DocumentEntity.fromDomain(Document.create(
                workspaceId, "Final report", DocumentContent.of(DOC_JSON), author, NOW))).toDomain();
    }

    /** The document moved to {@code revision}, as a save would leave it. */
    private Document atRevision(Document document, long revision) {
        return new Document(document.id(), document.workspaceId(), document.title(), document.content(),
                document.contentFormat(), revision, document.createdBy(), document.createdAt(), NOW, null);
    }

    private DocumentVersionEntity snapshot(Document document, DocumentVersionReason reason, UUID by, Instant at) {
        return versions.saveAndFlush(DocumentVersionEntity.fromDomain(
                DocumentVersion.snapshotOf(document, reason, by, at)));
    }

    @Test
    void storesASnapshotWithItsContentAsJson() {
        UUID author = insertUser("ada@example.com");
        Document document = insertDocument(author);

        DocumentVersionEntity saved = snapshot(document, DocumentVersionReason.CREATED, author, NOW);

        assertNotNull(saved.getId());
        assertEquals("object", jdbcTemplate.queryForObject(
                "SELECT jsonb_typeof(content) FROM document_versions WHERE id = ?", String.class, saved.getId()));
        DocumentVersion read = versions.findByDocumentIdAndId(document.id(), saved.getId()).orElseThrow()
                .toDomain();
        assertEquals(DOC_JSON, read.content().json());
        assertEquals(DocumentVersionReason.CREATED, read.reason());
        assertEquals(1L, read.revision());
    }

    @Test
    void listsNewestRevisionFirstWithoutContent() {
        UUID author = insertUser("ada@example.com");
        Document document = insertDocument(author);
        snapshot(document, DocumentVersionReason.CREATED, author, NOW);
        snapshot(atRevision(document, 4L), DocumentVersionReason.MANUAL_SAVE, author, NOW.plusSeconds(60));
        snapshot(atRevision(document, 2L), DocumentVersionReason.AUTOSAVE_CHECKPOINT, author, NOW.plusSeconds(30));

        List<DocumentVersionRepository.VersionSummaryRow> rows =
                versions.findByDocumentIdOrderByRevisionDesc(document.id());

        assertEquals(List.of(4L, 2L, 1L), rows.stream().map(DocumentVersionRepository.VersionSummaryRow::getRevision)
                .toList());
        assertEquals(DocumentVersionReason.MANUAL_SAVE, rows.get(0).getReason());
        assertEquals(Optional.of(NOW.plusSeconds(60)), versions.findNewestCreatedAt(document.id()));
    }

    @Test
    void aDocumentWithNoSnapshotsHasNoNewest() {
        UUID author = insertUser("ada@example.com");

        assertEquals(Optional.empty(), versions.findNewestCreatedAt(insertDocument(author).id()));
    }

    @Test
    void aVersionIsFoundOnlyThroughItsOwnDocument() {
        UUID author = insertUser("ada@example.com");
        Document mine = insertDocument(author);
        Document other = insertDocument(author);
        DocumentVersionEntity version = snapshot(mine, DocumentVersionReason.CREATED, author, NOW);

        assertTrue(versions.findByDocumentIdAndId(other.id(), version.getId()).isEmpty(),
                "A version id tried against another document matches nothing");
        assertTrue(versions.findByDocumentIdAndId(mine.id(), version.getId()).isPresent());
    }

    @Test
    void multipleNamedSnapshotsCanCaptureTheSameRevisionWithoutReplacingEarlierHistory() {
        UUID author = insertUser("ada@example.com");
        Document document = insertDocument(author);
        var first = snapshot(document, DocumentVersionReason.CREATED, author, NOW);
        var second = snapshot(document, DocumentVersionReason.MANUAL_SNAPSHOT, author, NOW.plusSeconds(1));
        var rows = versions.findByDocumentIdOrderByRevisionDesc(document.id());
        assertEquals(List.of(second.getId(), first.getId()), rows.stream().map(DocumentVersionRepository.VersionSummaryRow::getId).toList());
        assertEquals(List.of(1L, 1L), rows.stream().map(DocumentVersionRepository.VersionSummaryRow::getRevision).toList());
    }

    @Test
    void aSnapshotCannotBeUpdatedByAnyStatement() {
        UUID author = insertUser("ada@example.com");
        UUID versionId = snapshot(insertDocument(author), DocumentVersionReason.CREATED, author, NOW).getId();

        DataIntegrityViolationException failure = assertThrows(DataIntegrityViolationException.class,
                () -> jdbcTemplate.update(
                        "UPDATE document_versions SET content = '{\"type\":\"doc\"}'::jsonb WHERE id = ?",
                        versionId));
        assertTrue(failure.getMessage().contains("immutable"), failure.getMessage());
    }

    @Test
    void aSnapshotCannotBeDeletedByAnyStatement() {
        UUID author = insertUser("ada@example.com");
        UUID versionId = snapshot(insertDocument(author), DocumentVersionReason.CREATED, author, NOW).getId();

        DataIntegrityViolationException failure = assertThrows(DataIntegrityViolationException.class,
                () -> jdbcTemplate.update("DELETE FROM document_versions WHERE id = ?", versionId));
        assertTrue(failure.getMessage().contains("immutable"), failure.getMessage());
    }

    @Test
    void aRestoreMustNameItsSourceInTheDatabaseToo() {
        UUID author = insertUser("ada@example.com");
        Document document = insertDocument(author);

        DataIntegrityViolationException failure = assertThrows(DataIntegrityViolationException.class,
                () -> jdbcTemplate.update("""
                        INSERT INTO document_versions
                            (id, document_id, revision, content_format, content, reason, created_by, created_at)
                        VALUES (?, ?, 2, 'PROSEMIRROR_JSON', '{"type":"doc"}'::jsonb, 'RESTORE', ?, ?)
                        """, UUID.randomUUID(), document.id(), author, timestamp(NOW)));
        assertTrue(failure.getMessage().contains("ck_document_versions_restore_source"), failure.getMessage());
    }

    @Test
    void aSnapshotMustBelongToARealDocument() {
        UUID author = insertUser("ada@example.com");
        Document ghost = new Document(UUID.randomUUID(), UUID.randomUUID(), "Ghost", DocumentContent.of(DOC_JSON),
                dev.researchhub.document.domain.DocumentContentFormat.PROSEMIRROR_JSON, 1L, author, NOW, NOW, null);

        DataIntegrityViolationException failure = assertThrows(DataIntegrityViolationException.class,
                () -> snapshot(ghost, DocumentVersionReason.CREATED, author, NOW));
        assertTrue(failure.getMessage().contains("fk_document_versions_document"), failure.getMessage());
    }

    @Test
    void theEntityIsNeverSavedTwice() {
        UUID author = insertUser("ada@example.com");
        DocumentVersion stored = snapshot(insertDocument(author), DocumentVersionReason.CREATED, author, NOW)
                .toDomain();

        assertThrows(IllegalArgumentException.class, () -> DocumentVersionEntity.fromDomain(stored));
    }

}
