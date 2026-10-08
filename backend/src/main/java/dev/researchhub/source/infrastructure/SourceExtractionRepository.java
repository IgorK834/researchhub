package dev.researchhub.source.infrastructure;

import dev.researchhub.processing.application.SourceExtraction;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import tools.jackson.databind.ObjectMapper;

import java.time.Instant;
import java.sql.Timestamp;
import java.util.Optional;
import java.util.UUID;

@Repository
public class SourceExtractionRepository {
    private final JdbcTemplate jdbc;
    private final ObjectMapper mapper;
    public SourceExtractionRepository(JdbcTemplate jdbc, ObjectMapper mapper) {
        this.jdbc = jdbc;
        this.mapper = mapper;
    }
    public void save(UUID workspaceId, UUID sourceId, UUID sourceVersionId, UUID jobId,
                     SourceExtraction extraction, Instant now) {
        String json = mapper.writeValueAsString(extraction);
        String hash;
        try {
            hash = java.util.HexFormat.of().formatHex(java.security.MessageDigest.getInstance("SHA-256")
                    .digest(json.getBytes(java.nio.charset.StandardCharsets.UTF_8)));
        } catch (java.security.NoSuchAlgorithmException impossible) { throw new IllegalStateException(impossible); }
        int saved = jdbc.update("""
                INSERT INTO source_extractions(source_id, workspace_id, job_id, parser_version, content_sha256,
                    payload, created_at, processing_version, schema_version, payload_sha256)
                VALUES (?, ?, ?, ?, ?, ?::jsonb, ?, ?, '4.0', ?)
                ON CONFLICT (source_id) DO UPDATE SET job_id = EXCLUDED.job_id, parser_version = EXCLUDED.parser_version,
                    content_sha256 = EXCLUDED.content_sha256,
                    payload = CASE WHEN source_extractions.payload_sha256 = EXCLUDED.payload_sha256
                                   THEN source_extractions.payload ELSE EXCLUDED.payload END,
                    created_at = EXCLUDED.created_at, processing_version = EXCLUDED.processing_version,
                    schema_version = EXCLUDED.schema_version, payload_sha256 = EXCLUDED.payload_sha256
                WHERE source_extractions.workspace_id = EXCLUDED.workspace_id
                """, sourceId, workspaceId, jobId, extraction.parserVersion(),
                extraction.extractionMetadata().contentSha256(), json, Timestamp.from(now), extraction.processingVersion(), hash);
        if (saved != 1) throw new IllegalStateException("Source extraction was not persisted");
        int archived = jdbc.update("""
                INSERT INTO source_version_extractions(source_version_id, source_id, workspace_id, job_id,
                    parser_version, content_sha256, payload, created_at, processing_version, schema_version, payload_sha256)
                VALUES (?, ?, ?, ?, ?, ?, ?::jsonb, ?, ?, '4.0', ?)
                ON CONFLICT(source_version_id) DO UPDATE SET job_id=EXCLUDED.job_id,
                    parser_version=EXCLUDED.parser_version, content_sha256=EXCLUDED.content_sha256,
                    payload=EXCLUDED.payload, created_at=EXCLUDED.created_at,
                    processing_version=EXCLUDED.processing_version, schema_version=EXCLUDED.schema_version,
                    payload_sha256=EXCLUDED.payload_sha256
                WHERE source_version_extractions.source_id=EXCLUDED.source_id
                  AND source_version_extractions.workspace_id=EXCLUDED.workspace_id
                  AND source_version_extractions.content_sha256=EXCLUDED.content_sha256
                """, sourceVersionId, sourceId, workspaceId, jobId, extraction.parserVersion(),
                extraction.extractionMetadata().contentSha256(), json, Timestamp.from(now),
                extraction.processingVersion(), hash);
        if (archived != 1) throw new IllegalStateException("Versioned source extraction was not persisted");
        jdbc.update("""
                INSERT INTO source_extraction_runs(job_id, source_id, workspace_id, parser_version, processing_version,
                    schema_version, payload_sha256, persisted_at, source_version_id) VALUES (?, ?, ?, ?, ?, '4.0', ?, ?, ?)
                ON CONFLICT (job_id) DO UPDATE SET parser_version = EXCLUDED.parser_version,
                    processing_version = EXCLUDED.processing_version, schema_version = EXCLUDED.schema_version,
                    payload_sha256 = EXCLUDED.payload_sha256,
                    persisted_at = CASE WHEN source_extraction_runs.payload_sha256 = EXCLUDED.payload_sha256
                                        THEN source_extraction_runs.persisted_at ELSE EXCLUDED.persisted_at END
                """, jobId, sourceId, workspaceId, extraction.parserVersion(), extraction.processingVersion(), hash,
                Timestamp.from(now), sourceVersionId);
    }
    public boolean existsForJob(UUID workspaceId, UUID sourceId, UUID jobId) {
        return Boolean.TRUE.equals(jdbc.queryForObject("""
                SELECT EXISTS(SELECT 1 FROM source_extractions WHERE workspace_id = ? AND source_id = ? AND job_id = ?)
                """, Boolean.class, workspaceId, sourceId, jobId));
    }
    public java.util.List<dev.researchhub.source.application.ExtractionRun> runs(UUID workspaceId, UUID sourceId) {
        return jdbc.query("""
                SELECT run.job_id, run.parser_version, run.processing_version, run.schema_version,
                       run.payload_sha256, run.persisted_at, job.status, run.retrieval_processing_version, run.chunking_config::text
                FROM source_extraction_runs run JOIN processing_jobs job ON job.id = run.job_id
                WHERE run.workspace_id = ? AND run.source_id = ? ORDER BY job.generation DESC
                LIMIT 100
                """, (row, _index) -> new dev.researchhub.source.application.ExtractionRun(row.getObject(1, UUID.class),
                row.getString(2), row.getString(3), row.getString(4), row.getString(5), row.getTimestamp(6).toInstant(), row.getString(7), row.getString(8),
                row.getString(9) == null ? null : mapper.readValue(row.getString(9), dev.researchhub.ai.application.ChunkingConfig.class)), workspaceId, sourceId);
    }
    public Optional<SourceExtraction> find(UUID workspaceId, UUID sourceId) {
        return jdbc.query("SELECT payload::text FROM source_extractions WHERE workspace_id = ? AND source_id = ?",
                (row, _index) -> mapper.readValue(row.getString(1), SourceExtraction.class), workspaceId, sourceId)
                .stream().findFirst();
    }
    public Optional<SourceExtraction> findVersion(UUID workspaceId, UUID sourceId, UUID sourceVersionId) {
        return jdbc.query("""
                SELECT payload::text FROM source_version_extractions
                WHERE workspace_id=? AND source_id=? AND source_version_id=?
                """, (row, _index) -> mapper.readValue(row.getString(1), SourceExtraction.class),
                workspaceId, sourceId, sourceVersionId).stream().findFirst();
    }
    /**
     * Only the tabular profile of an archived version, so a dataset preview never deserializes the extracted text.
     * Empty for a missing row and for a non-tabular version (JSON null or an absent key).
     */
    public Optional<SourceExtraction.WorkbookMetadata> findVersionWorkbook(UUID workspaceId, UUID sourceId,
                                                                          UUID sourceVersionId) {
        return jdbc.query("""
                SELECT (payload -> 'workbook')::text FROM source_version_extractions
                WHERE workspace_id=? AND source_id=? AND source_version_id=?
                """, (row, _index) -> row.getString(1), workspaceId, sourceId, sourceVersionId).stream()
                .findFirst().filter(text -> text != null && !"null".equals(text))
                .map(text -> mapper.readValue(text, SourceExtraction.WorkbookMetadata.class));
    }
    /** Serializes result writes with stale recovery; an obsolete delivery cannot publish output. */
    public boolean lockCurrentAttempt(UUID jobId, UUID workspaceId, UUID sourceId, int attempt) {
        return !jdbc.query("""
                SELECT id FROM processing_jobs WHERE id = ? AND workspace_id = ? AND resource_id = ?
                    AND status = 'RUNNING' AND attempt_count = ?
                    AND generation = (SELECT MAX(generation) FROM processing_jobs newer WHERE newer.resource_id = processing_jobs.resource_id
                        AND newer.job_type = processing_jobs.job_type AND newer.resource_type = processing_jobs.resource_type) FOR UPDATE
                """, (row, _index) -> row.getObject(1, UUID.class), jobId, workspaceId, sourceId, attempt).isEmpty();
    }
}
