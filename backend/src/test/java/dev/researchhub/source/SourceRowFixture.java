package dev.researchhub.source;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.UUID;

/**
 * Raw-SQL source rows for tests that must bypass the services.
 *
 * <p>Since V19 a source row always names an active immutable version, and the foreign key between them is deferred to
 * commit. One transaction therefore writes the source and version 1 together; inside a test transaction it simply
 * joins it.
 */
public final class SourceRowFixture {

    private SourceRowFixture() {
    }

    /** A READY text source whose single version has {@code sources/<id>} as storage key. Returns the version id. */
    public static UUID insertReadyText(JdbcTemplate jdbc, UUID sourceId, UUID workspaceId, UUID uploadedBy,
                                       String displayName) {
        return insert(jdbc, sourceId, workspaceId, uploadedBy, "paper.txt", displayName, "text/plain", "TXT", 20,
                "sources/" + sourceId, "a".repeat(64), "READY", null, Instant.now());
    }

    /** Inserts a source and its version 1 atomically; returns the version id. */
    public static UUID insert(JdbcTemplate jdbc, UUID sourceId, UUID workspaceId, UUID uploadedBy, String filename,
                              String displayName, String mediaType, String sourceType, long sizeBytes,
                              String storageKey, String sha256, String status, String failureSummary, Instant at) {
        UUID versionId = UUID.randomUUID();
        Timestamp timestamp = Timestamp.from(at);
        new TransactionTemplate(new DataSourceTransactionManager(jdbc.getDataSource())).executeWithoutResult(tx -> {
            jdbc.update("""
                    INSERT INTO sources(id, workspace_id, original_filename, display_name, media_type, source_type,
                                        size_bytes, storage_key, content_sha256, status, failure_summary, uploaded_by,
                                        created_at, updated_at, active_version_id, active_version_number)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
                    """, sourceId, workspaceId, filename, displayName, mediaType, sourceType, sizeBytes, storageKey,
                    sha256, status, failureSummary, uploadedBy, timestamp, timestamp, versionId);
            jdbc.update("""
                    INSERT INTO source_versions(id, source_id, workspace_id, version_number, original_filename,
                                                media_type, source_type, size_bytes, storage_key, content_sha256,
                                                status, failure_summary, uploaded_by, created_at, updated_at)
                    VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """, versionId, sourceId, workspaceId, filename, mediaType, sourceType, sizeBytes, storageKey,
                    sha256, status, failureSummary, uploadedBy, timestamp, timestamp);
        });
        return versionId;
    }

    /**
     * Adds an immutable version and makes it the source's active projection, as a replacement does. Returns the new
     * version id.
     */
    public static UUID addVersion(JdbcTemplate jdbc, UUID sourceId, int versionNumber, String filename,
                                  String mediaType, String sourceType, long sizeBytes, String storageKey,
                                  String sha256, String status, Instant at) {
        UUID versionId = UUID.randomUUID();
        Timestamp timestamp = Timestamp.from(at);
        new TransactionTemplate(new DataSourceTransactionManager(jdbc.getDataSource())).executeWithoutResult(tx -> {
            jdbc.update("""
                    INSERT INTO source_versions(id, source_id, workspace_id, version_number, original_filename,
                                                media_type, source_type, size_bytes, storage_key, content_sha256,
                                                status, uploaded_by, created_at, updated_at)
                    SELECT ?, id, workspace_id, ?, ?, ?, ?, ?, ?, ?, ?, uploaded_by, ?, ?
                    FROM sources WHERE id = ?
                    """, versionId, versionNumber, filename, mediaType, sourceType, sizeBytes, storageKey, sha256,
                    status, timestamp, timestamp, sourceId);
            jdbc.update("""
                    UPDATE sources SET original_filename = ?, media_type = ?, source_type = ?, size_bytes = ?,
                        storage_key = ?, content_sha256 = ?, status = ?, updated_at = ?, active_version_id = ?,
                        active_version_number = ?
                    WHERE id = ?
                    """, filename, mediaType, sourceType, sizeBytes, storageKey, sha256, status, timestamp,
                    versionId, versionNumber, sourceId);
        });
        return versionId;
    }
}
