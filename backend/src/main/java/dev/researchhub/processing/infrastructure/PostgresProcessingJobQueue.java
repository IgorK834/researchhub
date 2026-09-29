package dev.researchhub.processing.infrastructure;

import dev.researchhub.processing.application.ProcessingJobQueue;
import dev.researchhub.processing.application.StaleJobRecovery;
import dev.researchhub.processing.domain.ProcessingJob;
import dev.researchhub.processing.domain.ProcessingJobError;
import dev.researchhub.processing.domain.ProcessingJobStatus;
import dev.researchhub.processing.domain.ProcessingJobType;
import dev.researchhub.processing.domain.ProcessingResourceType;
import org.springframework.context.annotation.Profile;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/** PostgreSQL implementation whose single-statement claim uses {@code FOR UPDATE SKIP LOCKED}. */
@Repository
@Profile("local")
public class PostgresProcessingJobQueue implements ProcessingJobQueue {

    private static final String COLUMNS = """
            id, workspace_id, job_type, resource_type, resource_id, status, attempt_count, created_at,
            started_at, finished_at, last_error_code, last_error_message, next_attempt_at
            """;

    private static final RowMapper<ProcessingJob> ROW_MAPPER = PostgresProcessingJobQueue::map;

    private final JdbcTemplate jdbc;

    public PostgresProcessingJobQueue(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    public ProcessingJob insertIfAbsent(ProcessingJob job) {
        jdbc.update("""
                INSERT INTO processing_jobs (
                    id, workspace_id, job_type, resource_type, resource_id, status, attempt_count, created_at,
                    started_at, finished_at, last_error_code, last_error_message, next_attempt_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT (job_type, resource_type, resource_id) DO NOTHING
                """, job.id(), job.workspaceId(), job.jobType().name(), job.resourceType().name(), job.resourceId(),
                job.status().name(), job.attemptCount(), timestamp(job.createdAt()), timestamp(job.startedAt()),
                timestamp(job.finishedAt()), errorCode(job), errorMessage(job), timestamp(job.nextAttemptAt()));

        return findByResource(job.jobType(), job.resourceType(), job.resourceId()).orElseThrow(() ->
                new IllegalStateException("processing job insert did not create or find its idempotent row"));
    }

    @Override
    public Optional<ProcessingJob> find(UUID jobId) {
        return first("SELECT " + COLUMNS + " FROM processing_jobs WHERE id = ?", jobId);
    }

    @Override
    public Optional<ProcessingJob> findByResource(ProcessingJobType jobType, ProcessingResourceType resourceType,
                                                  UUID resourceId) {
        return first("SELECT " + COLUMNS + " FROM processing_jobs "
                        + "WHERE job_type = ? AND resource_type = ? AND resource_id = ?",
                jobType.name(), resourceType.name(), resourceId);
    }

    @Override
    public Optional<ProcessingJob> claimNext(Instant now, int maxAttempts) {
        List<ProcessingJob> claimed = jdbc.query("""
                WITH candidate AS (
                    SELECT id FROM processing_jobs
                    WHERE status = 'PENDING' AND next_attempt_at <= ? AND attempt_count < ?
                    ORDER BY next_attempt_at, created_at, id
                    FOR UPDATE SKIP LOCKED
                    LIMIT 1
                )
                UPDATE processing_jobs job
                SET status = 'RUNNING', attempt_count = job.attempt_count + 1, started_at = ?,
                    finished_at = NULL, last_error_code = NULL, last_error_message = NULL, next_attempt_at = NULL
                FROM candidate
                WHERE job.id = candidate.id
                RETURNING job.id, job.workspace_id, job.job_type, job.resource_type, job.resource_id, job.status,
                          job.attempt_count, job.created_at, job.started_at, job.finished_at,
                          job.last_error_code, job.last_error_message, job.next_attempt_at
                """, ROW_MAPPER, timestamp(now), maxAttempts, timestamp(now));
        return claimed.stream().findFirst();
    }

    @Override
    public boolean updateState(UUID jobId, ProcessingJobStatus expectedStatus, int expectedAttemptCount,
                               ProcessingJob updated) {
        int changed = jdbc.update("""
                UPDATE processing_jobs
                SET status = ?, attempt_count = ?, started_at = ?, finished_at = ?,
                    last_error_code = ?, last_error_message = ?, next_attempt_at = ?
                WHERE id = ? AND status = ? AND attempt_count = ?
                """, updated.status().name(), updated.attemptCount(), timestamp(updated.startedAt()),
                timestamp(updated.finishedAt()), errorCode(updated), errorMessage(updated),
                timestamp(updated.nextAttemptAt()), jobId, expectedStatus.name(), expectedAttemptCount);
        return changed == 1;
    }

    @Override
    public StaleJobRecovery recoverStale(Instant staleBefore, Instant now, int maxAttempts) {
        ProcessingJobError timeout = new ProcessingJobError("WORKER_TIMEOUT",
                "The processing worker did not finish before the timeout.");
        List<ProcessingJob> failed = jdbc.query("""
                UPDATE processing_jobs
                SET status = 'FAILED', finished_at = ?, last_error_code = ?, last_error_message = ?,
                    next_attempt_at = NULL
                WHERE status = 'RUNNING' AND started_at <= ? AND attempt_count >= ?
                RETURNING %s
                """.formatted(COLUMNS), ROW_MAPPER, timestamp(now), timeout.code(), timeout.message(),
                timestamp(staleBefore), maxAttempts);
        List<ProcessingJob> requeued = jdbc.query("""
                UPDATE processing_jobs
                SET status = 'PENDING', started_at = NULL, finished_at = NULL,
                    last_error_code = ?, last_error_message = ?, next_attempt_at = ?
                WHERE status = 'RUNNING' AND started_at <= ? AND attempt_count < ?
                RETURNING %s
                """.formatted(COLUMNS), ROW_MAPPER, timeout.code(), timeout.message(), timestamp(now),
                timestamp(staleBefore), maxAttempts);
        return new StaleJobRecovery(requeued, failed);
    }

    private Optional<ProcessingJob> first(String sql, Object... arguments) {
        return jdbc.query(sql, ROW_MAPPER, arguments).stream().findFirst();
    }

    private static ProcessingJob map(ResultSet row, int rowNumber) throws SQLException {
        String errorCode = row.getString("last_error_code");
        ProcessingJobError error = errorCode == null ? null
                : new ProcessingJobError(errorCode, row.getString("last_error_message"));
        return new ProcessingJob(row.getObject("id", UUID.class), row.getObject("workspace_id", UUID.class),
                ProcessingJobType.valueOf(row.getString("job_type")),
                ProcessingResourceType.valueOf(row.getString("resource_type")),
                row.getObject("resource_id", UUID.class), ProcessingJobStatus.valueOf(row.getString("status")),
                row.getInt("attempt_count"), instant(row, "created_at"), instant(row, "started_at"),
                instant(row, "finished_at"), error, instant(row, "next_attempt_at"));
    }

    private static Timestamp timestamp(Instant value) {
        return value == null ? null : Timestamp.from(value);
    }

    private static Instant instant(ResultSet row, String column) throws SQLException {
        Timestamp value = row.getTimestamp(column);
        return value == null ? null : value.toInstant();
    }

    private static String errorCode(ProcessingJob job) {
        return job.lastError() == null ? null : job.lastError().code();
    }

    private static String errorMessage(ProcessingJob job) {
        return job.lastError() == null ? null : job.lastError().message();
    }
}
