-- Durable boundary between the Java application and asynchronous processing workers.
-- The row is the source of truth: HTTP delivery may be retried, but a job is never represented only in memory.

CREATE TABLE processing_jobs
(
    id                 uuid         NOT NULL,
    workspace_id       uuid         NOT NULL,
    job_type            varchar(32)  NOT NULL,
    resource_type       varchar(32)  NOT NULL,
    resource_id         uuid         NOT NULL,
    status              varchar(16)  NOT NULL,
    attempt_count       integer      NOT NULL,
    created_at          timestamptz  NOT NULL,
    started_at          timestamptz,
    finished_at         timestamptz,
    last_error_code     varchar(64),
    last_error_message  varchar(500),
    next_attempt_at     timestamptz,

    CONSTRAINT pk_processing_jobs PRIMARY KEY (id),
    CONSTRAINT fk_processing_jobs_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces (id),
    CONSTRAINT uq_processing_jobs_resource UNIQUE (job_type, resource_type, resource_id),
    CONSTRAINT ck_processing_jobs_type CHECK (job_type IN ('SOURCE_INGEST')),
    CONSTRAINT ck_processing_jobs_resource_type CHECK (resource_type IN ('SOURCE')),
    CONSTRAINT ck_processing_jobs_status CHECK (status IN ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED')),
    CONSTRAINT ck_processing_jobs_attempt_count CHECK (attempt_count BETWEEN 0 AND 100),
    CONSTRAINT ck_processing_jobs_error_pair CHECK (
        (last_error_code IS NULL AND last_error_message IS NULL)
            OR (last_error_code IS NOT NULL AND last_error_message IS NOT NULL
            AND length(btrim(last_error_code)) > 0 AND length(btrim(last_error_message)) > 0)
        ),
    CONSTRAINT ck_processing_jobs_state_fields CHECK (
        (status = 'PENDING' AND started_at IS NULL AND finished_at IS NULL AND next_attempt_at IS NOT NULL
            AND ((attempt_count = 0 AND last_error_code IS NULL)
                OR (attempt_count > 0 AND last_error_code IS NOT NULL)))
        OR (status = 'RUNNING' AND attempt_count > 0 AND started_at IS NOT NULL AND finished_at IS NULL
            AND next_attempt_at IS NULL AND last_error_code IS NULL)
        OR (status = 'SUCCEEDED' AND attempt_count > 0 AND started_at IS NOT NULL AND finished_at IS NOT NULL
            AND next_attempt_at IS NULL AND last_error_code IS NULL)
        OR (status = 'FAILED' AND attempt_count > 0 AND started_at IS NOT NULL AND finished_at IS NOT NULL
            AND next_attempt_at IS NULL AND last_error_code IS NOT NULL)
        OR (status = 'CANCELLED' AND finished_at IS NOT NULL AND next_attempt_at IS NULL
            AND last_error_code IS NULL)
        ),
    CONSTRAINT ck_processing_jobs_time_order CHECK (
        (started_at IS NULL OR started_at >= created_at)
            AND (finished_at IS NULL OR finished_at >= created_at)
            AND (next_attempt_at IS NULL OR next_attempt_at >= created_at)
        )
);

-- The dispatcher scans only eligible pending work in this exact order. The predicate keeps the index compact.
CREATE INDEX ix_processing_jobs_dispatch
    ON processing_jobs (next_attempt_at, created_at, id)
    WHERE status = 'PENDING';

CREATE INDEX ix_processing_jobs_workspace ON processing_jobs (workspace_id, created_at DESC);

CREATE FUNCTION processing_job_identity_is_immutable() RETURNS trigger
    LANGUAGE plpgsql AS
$$
BEGIN
    IF NEW.id IS DISTINCT FROM OLD.id
        OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
        OR NEW.job_type IS DISTINCT FROM OLD.job_type
        OR NEW.resource_type IS DISTINCT FROM OLD.resource_type
        OR NEW.resource_id IS DISTINCT FROM OLD.resource_id
        OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
        RAISE EXCEPTION 'processing job identity is immutable for job %', OLD.id
            USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER tg_processing_job_identity_is_immutable
    BEFORE UPDATE ON processing_jobs
    FOR EACH ROW EXECUTE FUNCTION processing_job_identity_is_immutable();

COMMENT ON TABLE processing_jobs IS
    'Durable processing queue and attempt state. Worker delivery is idempotent by job id.';
COMMENT ON COLUMN processing_jobs.last_error_message IS
    'Bounded user-safe summary only. Detailed exceptions remain in server logs.';
