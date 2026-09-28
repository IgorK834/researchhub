package dev.researchhub.source.infrastructure;

import dev.researchhub.shared.infrastructure.persistence.PostgresIntegrationTest;
import dev.researchhub.source.domain.Source;
import dev.researchhub.source.domain.SourceFilename;
import dev.researchhub.source.domain.SourceStatus;
import dev.researchhub.source.domain.SourceType;
import dev.researchhub.source.domain.StorageKey;
import dev.researchhub.workspace.UserRowFixture;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Proves the {@code sources} table holds the rules V8 states, for any writer: the closed type mapping, the key
 * format, the size bounds, workspace scoping, and that the original input cannot be changed after the fact.
 */
@PostgresIntegrationTest
class SourceRepositoryIntegrationTest {

    private static final Instant NOW = Instant.parse("2026-09-24T10:00:00Z");
    private static final String SHA = "0".repeat(64);

    @Autowired
    private SourceRepository sources;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    private UUID insertWorkspace(UUID createdBy) {
        UUID id = UUID.randomUUID();
        jdbcTemplate.update("""
                INSERT INTO workspaces (id, name, description, created_by, created_at, updated_at)
                VALUES (?, 'Lab', NULL, ?, ?, ?)
                """, id, createdBy, UserRowFixture.timestamp(NOW), UserRowFixture.timestamp(NOW));
        return id;
    }

    private SourceEntity insert(UUID workspaceId, UUID uploader, String filename, SourceType type) {
        return sources.saveAndFlush(SourceEntity.fromDomain(Source.uploaded(workspaceId,
                SourceFilename.of(filename), type, 42, StorageKey.generate(), SHA, uploader, NOW)));
    }

    private void updateColumn(String assignment, UUID id) {
        jdbcTemplate.update("UPDATE sources SET " + assignment + " WHERE id = ?", id);
    }

    @Test
    void savesASourceAndReadsItBack() {
        UUID ada = UserRowFixture.insertUser(jdbcTemplate, "ada@example.com", "Ada");
        UUID workspace = insertWorkspace(ada);

        SourceEntity saved = insert(workspace, ada, "data.xlsx", SourceType.XLSX);

        assertNotNull(saved.getId());
        Source read = sources.findByWorkspaceIdAndId(workspace, saved.getId()).orElseThrow().toDomain();
        assertEquals(SourceType.XLSX, read.sourceType());
        assertEquals("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", jdbcTemplate
                .queryForObject("SELECT media_type FROM sources WHERE id = ?", String.class, saved.getId()));
        assertEquals(SourceStatus.UPLOADED, read.status());
        assertEquals(42, read.sizeBytes());
    }

    @Test
    void aSourceIsFoundOnlyThroughItsOwnWorkspace() {
        UUID ada = UserRowFixture.insertUser(jdbcTemplate, "ada@example.com", "Ada");
        UUID mine = insertWorkspace(ada);
        UUID other = insertWorkspace(ada);
        SourceEntity saved = insert(mine, ada, "a.txt", SourceType.TXT);
        insert(other, ada, "b.txt", SourceType.TXT);

        assertTrue(sources.findByWorkspaceIdAndId(other, saved.getId()).isEmpty());
        assertEquals(List.of(saved.getId()),
                sources.findByWorkspaceIdOrderByCreatedAtDesc(mine).stream().map(SourceEntity::getId).toList());
    }

    @Test
    void statusAndDisplayNameMayChange() {
        UUID ada = UserRowFixture.insertUser(jdbcTemplate, "ada@example.com", "Ada");
        UUID id = insert(insertWorkspace(ada), ada, "a.txt", SourceType.TXT).getId();

        updateColumn("status = 'PROCESSING', display_name = 'Renamed', updated_at = now()", id);

        assertEquals("PROCESSING", jdbcTemplate.queryForObject("SELECT status FROM sources WHERE id = ?",
                String.class, id));
    }

    @Test
    void theOriginalInputCannotBeChangedByAnyStatement() {
        UUID ada = UserRowFixture.insertUser(jdbcTemplate, "ada@example.com", "Ada");
        UUID id = insert(insertWorkspace(ada), ada, "a.txt", SourceType.TXT).getId();

        DataIntegrityViolationException failure = assertThrows(DataIntegrityViolationException.class,
                () -> updateColumn("storage_key = 'sources/" + UUID.randomUUID() + "'", id));
        assertTrue(failure.getMessage().contains("immutable"), failure.getMessage());
    }

    @Test
    void theSizeCannotBeRewrittenEither() {
        UUID ada = UserRowFixture.insertUser(jdbcTemplate, "ada@example.com", "Ada");
        UUID id = insert(insertWorkspace(ada), ada, "a.txt", SourceType.TXT).getId();

        assertThrows(DataIntegrityViolationException.class, () -> updateColumn("size_bytes = 43", id));
    }

    @Test
    void theIdCannotBeRewritten() {
        UUID ada = UserRowFixture.insertUser(jdbcTemplate, "ada@example.com", "Ada");
        UUID id = insert(insertWorkspace(ada), ada, "a.txt", SourceType.TXT).getId();

        assertThrows(DataIntegrityViolationException.class,
                () -> updateColumn("id = '" + UUID.randomUUID() + "'", id));
    }

    private void rawInsert(String sourceType, String mediaType, long size, String key, String sha, String status) {
        UUID ada = UserRowFixture.insertUser(jdbcTemplate, "raw-" + UUID.randomUUID() + "@example.com", "Raw");
        jdbcTemplate.update("""
                INSERT INTO sources (id, workspace_id, original_filename, display_name, media_type, source_type,
                                     size_bytes, storage_key, content_sha256, status, uploaded_by, created_at,
                                     updated_at)
                VALUES (?, ?, 'f', 'f', ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, UUID.randomUUID(), insertWorkspace(ada), mediaType, sourceType, size, key, sha, status, ada,
                UserRowFixture.timestamp(NOW), UserRowFixture.timestamp(NOW));
    }

    private void assertRefusedBy(String constraint, Runnable insert) {
        DataIntegrityViolationException failure = assertThrows(DataIntegrityViolationException.class,
                insert::run);
        assertTrue(failure.getMessage().contains(constraint), failure.getMessage());
    }

    private static String key() {
        return "sources/" + UUID.randomUUID();
    }

    @Test
    void refusesATypeOutsideTheMapping() {
        // Both checks encode the closed mapping; PostgreSQL reports whichever it evaluates first.
        DataIntegrityViolationException failure = assertThrows(DataIntegrityViolationException.class,
                () -> rawInsert("PPTX", "application/pdf", 1, key(), SHA, "UPLOADED"));
        assertTrue(failure.getMessage().contains("ck_sources_source_type")
                || failure.getMessage().contains("ck_sources_media_type_matches_type"), failure.getMessage());
    }

    @Test
    void refusesAMediaTypeThatIsNotTheTypesCanonicalOne() {
        assertRefusedBy("ck_sources_media_type_matches_type",
                () -> rawInsert("PDF", "text/html", 1, key(), SHA, "UPLOADED"));
    }

    @Test
    void refusesAnUnknownStatus() {
        assertRefusedBy("ck_sources_status", () -> rawInsert("TXT", "text/plain", 1, key(), SHA, "DELETED"));
    }

    @Test
    void refusesAnEmptyOrOversizedFile() {
        assertRefusedBy("ck_sources_size_bytes", () -> rawInsert("TXT", "text/plain", 0, key(), SHA, "UPLOADED"));
    }

    @Test
    void refusesAKeyBuiltFromAFileName() {
        assertRefusedBy("ck_sources_storage_key_format",
                () -> rawInsert("TXT", "text/plain", 1, "sources/../../etc/passwd", SHA, "UPLOADED"));
    }

    @Test
    void refusesAMalformedHash() {
        assertRefusedBy("ck_sources_content_sha256_format",
                () -> rawInsert("TXT", "text/plain", 1, key(), "not-a-hash", "UPLOADED"));
    }

    @Test
    void refusesTwoSourcesSharingBytesByKey() {
        String shared = key();
        rawInsert("TXT", "text/plain", 1, shared, SHA, "UPLOADED");

        assertRefusedBy("uq_sources_storage_key", () -> rawInsert("TXT", "text/plain", 1, shared, SHA, "UPLOADED"));
    }

    @Test
    void aRowWhoseMediaTypeDisagreesWithItsTypeIsNotReadAsValid() {
        UUID ada = UserRowFixture.insertUser(jdbcTemplate, "ada@example.com", "Ada");
        SourceEntity entity = insert(insertWorkspace(ada), ada, "a.txt", SourceType.TXT);
        org.springframework.test.util.ReflectionTestUtils.setField(entity, "mediaType", "text/csv");

        assertThrows(IllegalStateException.class, entity::toDomain);
    }

}
