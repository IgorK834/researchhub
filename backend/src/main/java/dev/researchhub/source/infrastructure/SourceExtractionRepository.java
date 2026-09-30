package dev.researchhub.source.infrastructure;

import dev.researchhub.processing.application.SourceExtraction;
import org.springframework.context.annotation.Profile;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import tools.jackson.databind.ObjectMapper;

import java.time.Instant;
import java.sql.Timestamp;
import java.util.Optional;
import java.util.UUID;

@Repository
@Profile("local")
public class SourceExtractionRepository {
    private final JdbcTemplate jdbc;
    private final ObjectMapper mapper;
    public SourceExtractionRepository(JdbcTemplate jdbc, ObjectMapper mapper) {
        this.jdbc = jdbc;
        this.mapper = mapper;
    }
    public void save(UUID workspaceId, UUID sourceId, UUID jobId, SourceExtraction extraction, Instant now) {
        jdbc.update("""
                INSERT INTO source_extractions(source_id, workspace_id, job_id, parser_version, content_sha256, payload, created_at)
                VALUES (?, ?, ?, ?, ?, ?::jsonb, ?)
                ON CONFLICT (source_id) DO UPDATE SET job_id = EXCLUDED.job_id, parser_version = EXCLUDED.parser_version,
                    content_sha256 = EXCLUDED.content_sha256, payload = EXCLUDED.payload, created_at = EXCLUDED.created_at
                WHERE source_extractions.workspace_id = EXCLUDED.workspace_id
                """, sourceId, workspaceId, jobId, extraction.parserVersion(),
                extraction.extractionMetadata().contentSha256(), mapper.writeValueAsString(extraction), Timestamp.from(now));
    }
    public Optional<SourceExtraction> find(UUID workspaceId, UUID sourceId) {
        return jdbc.query("SELECT payload::text FROM source_extractions WHERE workspace_id = ? AND source_id = ?",
                (row, _index) -> mapper.readValue(row.getString(1), SourceExtraction.class), workspaceId, sourceId)
                .stream().findFirst();
    }
    /** Serializes result writes with stale recovery; an obsolete delivery cannot publish output. */
    public boolean lockCurrentAttempt(UUID jobId, UUID workspaceId, UUID sourceId, int attempt) {
        return !jdbc.query("""
                SELECT id FROM processing_jobs WHERE id = ? AND workspace_id = ? AND resource_id = ?
                    AND status = 'RUNNING' AND attempt_count = ? FOR UPDATE
                """, (row, _index) -> row.getObject(1, UUID.class), jobId, workspaceId, sourceId, attempt).isEmpty();
    }
}
