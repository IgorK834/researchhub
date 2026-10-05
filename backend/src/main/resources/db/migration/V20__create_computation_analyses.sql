-- Engine-independent computation requests and append-only planning audit (RH-140/141).
CREATE TABLE analyses (
    id uuid PRIMARY KEY,
    workspace_id uuid NOT NULL REFERENCES workspaces(id),
    created_by uuid NOT NULL REFERENCES users(id),
    user_prompt varchar(4000) NOT NULL CHECK (length(btrim(user_prompt))>0),
    status varchar(24) NOT NULL CHECK (status IN ('DRAFT','PLANNING','READY_TO_EXECUTE','RUNNING','SUCCEEDED','FAILED')),
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL CHECK (updated_at>=created_at),
    inputs jsonb NOT NULL CHECK (jsonb_typeof(inputs)='array' AND jsonb_array_length(inputs) BETWEEN 1 AND 5 AND octet_length(inputs::text)<=16384),
    plan_id uuid,
    plan jsonb CHECK (jsonb_typeof(plan)='object' AND octet_length(plan::text)<=262144),
    failure_code varchar(64),
    UNIQUE(workspace_id,id),
    CHECK ((plan_id IS NULL)=(plan IS NULL)),
    CHECK (status NOT IN ('READY_TO_EXECUTE','RUNNING','SUCCEEDED') OR plan_id IS NOT NULL),
    CHECK ((status='FAILED')=(failure_code IS NOT NULL))
);
CREATE INDEX ix_analyses_workspace ON analyses(workspace_id,created_at DESC,id DESC);
CREATE TABLE analysis_inputs (
    analysis_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    source_id uuid NOT NULL,
    source_version_id uuid NOT NULL,
    ordinal integer NOT NULL CHECK (ordinal BETWEEN 0 AND 4),
    PRIMARY KEY(analysis_id,ordinal),
    UNIQUE(analysis_id,source_version_id),
    FOREIGN KEY(workspace_id,analysis_id) REFERENCES analyses(workspace_id,id),
    FOREIGN KEY(source_version_id,source_id,workspace_id) REFERENCES source_versions(id,source_id,workspace_id)
);
CREATE TABLE analysis_plan_attempts (
    id uuid PRIMARY KEY,
    analysis_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    attempt integer NOT NULL CHECK (attempt BETWEEN 1 AND 3),
    payload jsonb NOT NULL CHECK (jsonb_typeof(payload)='object' AND octet_length(payload::text)<=1048576),
    created_at timestamptz NOT NULL,
    UNIQUE(analysis_id,attempt),
    UNIQUE(workspace_id,analysis_id,id),
    FOREIGN KEY(workspace_id,analysis_id) REFERENCES analyses(workspace_id,id)
);
ALTER TABLE analyses ADD CONSTRAINT fk_analysis_accepted_plan
    FOREIGN KEY(workspace_id,id,plan_id) REFERENCES analysis_plan_attempts(workspace_id,analysis_id,id);
CREATE TRIGGER tg_analysis_inputs_immutable BEFORE UPDATE OR DELETE ON analysis_inputs
    FOR EACH ROW EXECUTE FUNCTION preserve_ai_authoring_event();
CREATE TRIGGER tg_analysis_plan_attempts_immutable BEFORE UPDATE OR DELETE ON analysis_plan_attempts
    FOR EACH ROW EXECUTE FUNCTION preserve_ai_authoring_event();
CREATE FUNCTION preserve_analysis_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
       OR NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.created_at IS DISTINCT FROM OLD.created_at
       OR NEW.user_prompt IS DISTINCT FROM OLD.user_prompt OR NEW.inputs IS DISTINCT FROM OLD.inputs
       OR OLD.plan_id IS NOT NULL AND (NEW.plan_id IS DISTINCT FROM OLD.plan_id OR NEW.plan IS DISTINCT FROM OLD.plan) THEN
        RAISE EXCEPTION 'analysis intent and accepted plan are immutable' USING ERRCODE='restrict_violation';
    END IF;
    IF NOT ((OLD.status='DRAFT' AND NEW.status='PLANNING')
        OR (OLD.status='PLANNING' AND NEW.status IN ('READY_TO_EXECUTE','FAILED'))
        OR (OLD.status='READY_TO_EXECUTE' AND NEW.status='RUNNING')
        OR (OLD.status='RUNNING' AND NEW.status IN ('SUCCEEDED','FAILED'))) THEN
        RAISE EXCEPTION 'invalid analysis status transition' USING ERRCODE='restrict_violation';
    END IF;
    RETURN NEW;
END; $$;
CREATE TRIGGER tg_analysis_identity BEFORE UPDATE ON analyses FOR EACH ROW EXECUTE FUNCTION preserve_analysis_identity();
