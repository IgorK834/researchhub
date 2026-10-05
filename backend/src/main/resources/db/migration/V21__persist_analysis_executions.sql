-- RH-145: explicit durable isolated execution attempts and immutable published artifacts.
ALTER TABLE analyses DROP CONSTRAINT analyses_status_check;
ALTER TABLE analyses ADD CONSTRAINT analyses_status_check CHECK (status IN ('DRAFT','PLANNING','READY_TO_EXECUTE','QUEUED','RUNNING','SUCCEEDED','FAILED'));
CREATE OR REPLACE FUNCTION preserve_analysis_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
       OR NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.created_at IS DISTINCT FROM OLD.created_at
       OR NEW.user_prompt IS DISTINCT FROM OLD.user_prompt OR NEW.inputs IS DISTINCT FROM OLD.inputs
       OR OLD.plan_id IS NOT NULL AND (NEW.plan_id IS DISTINCT FROM OLD.plan_id OR NEW.plan IS DISTINCT FROM OLD.plan) THEN
        RAISE EXCEPTION 'analysis intent and accepted plan are immutable' USING ERRCODE='restrict_violation';
    END IF;
    IF NOT ((OLD.status='DRAFT' AND NEW.status='PLANNING')
        OR (OLD.status='PLANNING' AND NEW.status IN ('READY_TO_EXECUTE','FAILED'))
        OR (OLD.status IN ('READY_TO_EXECUTE','SUCCEEDED','FAILED') AND NEW.status='QUEUED' AND NEW.plan_id IS NOT NULL)
        OR (OLD.status='QUEUED' AND NEW.status IN ('RUNNING','FAILED'))
        OR (OLD.status='RUNNING' AND NEW.status IN ('SUCCEEDED','FAILED'))) THEN
        RAISE EXCEPTION 'invalid analysis status transition' USING ERRCODE='restrict_violation';
    END IF;
    RETURN NEW;
END; $$;
CREATE TABLE analysis_executions (
    id uuid PRIMARY KEY,
    analysis_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    requested_by uuid NOT NULL REFERENCES users(id),
    attempt integer NOT NULL CHECK (attempt BETWEEN 1 AND 100),
    status varchar(16) NOT NULL CHECK (status IN ('QUEUED','RUNNING','SUCCEEDED','FAILED')),
    payload jsonb NOT NULL CHECK (jsonb_typeof(payload)='object' AND octet_length(payload::text)<=2097152),
    created_at timestamptz NOT NULL,
    started_at timestamptz,
    finished_at timestamptz,
    UNIQUE(analysis_id,attempt),
    UNIQUE(workspace_id,analysis_id,id),
    FOREIGN KEY(workspace_id,analysis_id) REFERENCES analyses(workspace_id,id),
    CHECK ((status='QUEUED')=(started_at IS NULL)),
    CHECK ((status IN ('SUCCEEDED','FAILED'))=(finished_at IS NOT NULL)),
    CHECK (started_at>=created_at AND finished_at>=started_at),
    CHECK (payload->>'id'=id::text AND payload->>'analysisId'=analysis_id::text AND payload->>'workspaceId'=workspace_id::text
        AND payload->>'requestedBy'=requested_by::text AND (payload->>'attempt')::integer=attempt AND payload->>'status'=status)
);
CREATE UNIQUE INDEX uq_analysis_active_execution ON analysis_executions(analysis_id) WHERE status IN ('QUEUED','RUNNING');
CREATE INDEX ix_analysis_execution_queue ON analysis_executions(created_at,id) WHERE status='QUEUED';
CREATE TABLE analysis_execution_artifacts (
    id uuid PRIMARY KEY,
    execution_id uuid NOT NULL,
    analysis_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    filename varchar(100) NOT NULL CHECK (filename ~ '^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}\.(png|svg)$'),
    media_type varchar(32) NOT NULL CHECK (media_type IN ('image/png','image/svg+xml')),
    size_bytes integer NOT NULL CHECK (size_bytes BETWEEN 1 AND 8388608),
    sha256 varchar(64) NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
    content bytea NOT NULL CHECK (octet_length(content)=size_bytes),
    UNIQUE(execution_id,filename),
    FOREIGN KEY(workspace_id,analysis_id,execution_id) REFERENCES analysis_executions(workspace_id,analysis_id,id)
);
CREATE TRIGGER tg_execution_artifacts_immutable BEFORE UPDATE OR DELETE ON analysis_execution_artifacts
    FOR EACH ROW EXECUTE FUNCTION preserve_ai_authoring_event();
CREATE FUNCTION preserve_execution_attempt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP='DELETE' THEN RAISE EXCEPTION 'execution attempts cannot be deleted' USING ERRCODE='restrict_violation'; END IF;
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.analysis_id IS DISTINCT FROM OLD.analysis_id OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
        OR NEW.requested_by IS DISTINCT FROM OLD.requested_by OR NEW.attempt IS DISTINCT FROM OLD.attempt OR NEW.created_at IS DISTINCT FROM OLD.created_at
        OR NEW.payload->'provenance'->'planId' IS DISTINCT FROM OLD.payload->'provenance'->'planId'
        OR NEW.payload->'provenance'->'planSha256' IS DISTINCT FROM OLD.payload->'provenance'->'planSha256'
        OR NEW.payload->'provenance'->'codeSha256' IS DISTINCT FROM OLD.payload->'provenance'->'codeSha256'
        OR NEW.payload->'provenance'->'inputs' IS DISTINCT FROM OLD.payload->'provenance'->'inputs'
        OR NOT ((OLD.status='QUEUED' AND NEW.status='RUNNING') OR (OLD.status='RUNNING' AND NEW.status IN ('SUCCEEDED','FAILED'))) THEN
        RAISE EXCEPTION 'execution identity and completed attempts are immutable' USING ERRCODE='restrict_violation';
    END IF;
    RETURN NEW;
END; $$;
CREATE TRIGGER tg_execution_attempt_immutable BEFORE UPDATE OR DELETE ON analysis_executions
    FOR EACH ROW EXECUTE FUNCTION preserve_execution_attempt();
