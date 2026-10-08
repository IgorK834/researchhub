package dev.researchhub.source.infrastructure;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.util.Optional;
import java.util.UUID;

/** Immutable processing-job to source-version binding. */
@Repository
public class SourceVersionJobRepository {
    private final JdbcTemplate jdbc;
    public SourceVersionJobRepository(JdbcTemplate jdbc) { this.jdbc = jdbc; }

    public void bind(UUID jobId, UUID sourceVersionId) {
        int inserted = jdbc.update("INSERT INTO processing_job_source_versions(job_id,source_version_id) VALUES (?,?)",
                jobId, sourceVersionId);
        if (inserted != 1) throw new IllegalStateException("Processing input version was not recorded");
    }

    public Optional<UUID> findVersionId(UUID jobId) {
        return jdbc.query("SELECT source_version_id FROM processing_job_source_versions WHERE job_id=?",
                (row, index) -> row.getObject(1, UUID.class), jobId).stream().findFirst();
    }
}
