-- RH-230/231/232. Workspace-owned frozen IR and asynchronous render artifacts.
CREATE TABLE report_exports (
    id uuid PRIMARY KEY,
    workspace_id uuid NOT NULL REFERENCES workspaces(id),
    document_id uuid NOT NULL,
    requested_by uuid NOT NULL REFERENCES users(id),
    revision bigint NOT NULL CHECK (revision>=1),
    format varchar(8) NOT NULL CHECK (format IN ('DOCX','PDF')),
    status varchar(16) NOT NULL CHECK (status IN ('QUEUED','RUNNING','SUCCEEDED','FAILED','EXPIRED')),
    filename varchar(120) NOT NULL,
    warnings jsonb NOT NULL CHECK (jsonb_typeof(warnings)='array'),
    snapshot jsonb CHECK (jsonb_typeof(snapshot)='object' AND octet_length(snapshot::text)<=25165824),
    content bytea CHECK (octet_length(content)<=33554432),
    failure_code varchar(32) CHECK (failure_code IN ('RENDER_FAILED','OUTPUT_TOO_LARGE','ACCESS_REVOKED','RENDER_INTERRUPTED')),
    sha256 varchar(64) CHECK (sha256 ~ '^[a-f0-9]{64}$'),
    size_bytes bigint NOT NULL DEFAULT 0 CHECK (size_bytes BETWEEN 0 AND 33554432),
    created_at timestamptz NOT NULL,
    started_at timestamptz,
    finished_at timestamptz,
    expires_at timestamptz NOT NULL CHECK (expires_at>created_at),
    FOREIGN KEY(workspace_id,document_id) REFERENCES documents(workspace_id,id),
    CHECK ((status='EXPIRED')=(snapshot IS NULL)),
    CHECK (status<>'SUCCEEDED' OR content IS NOT NULL AND sha256 IS NOT NULL AND size_bytes=octet_length(content)),
    CHECK (status<>'FAILED' OR failure_code IS NOT NULL AND content IS NULL),
    CHECK (status NOT IN ('QUEUED','RUNNING') OR finished_at IS NULL AND content IS NULL),
    CHECK (status NOT IN ('RUNNING','SUCCEEDED','FAILED') OR started_at IS NOT NULL),
    CHECK (status NOT IN ('SUCCEEDED','FAILED','EXPIRED') OR finished_at IS NOT NULL),
    CHECK (started_at>=created_at AND finished_at>=started_at),
    CHECK (snapshot IS NULL OR snapshot->>'schemaVersion'='1.0' AND snapshot->>'workspaceId'=workspace_id::text
        AND snapshot->>'documentId'=document_id::text AND (snapshot->>'revision')::bigint=revision)
);
CREATE INDEX ix_report_exports_queue ON report_exports(created_at,id) WHERE status='QUEUED';
CREATE INDEX ix_report_exports_workspace_pending ON report_exports(workspace_id) WHERE status IN ('QUEUED','RUNNING');
CREATE INDEX ix_report_exports_expiry ON report_exports(expires_at) WHERE status<>'EXPIRED';

CREATE FUNCTION preserve_report_export() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
        OR NEW.document_id IS DISTINCT FROM OLD.document_id OR NEW.requested_by IS DISTINCT FROM OLD.requested_by
        OR NEW.revision IS DISTINCT FROM OLD.revision OR NEW.format IS DISTINCT FROM OLD.format
        OR NEW.filename IS DISTINCT FROM OLD.filename OR NEW.warnings IS DISTINCT FROM OLD.warnings
        OR NEW.created_at IS DISTINCT FROM OLD.created_at OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
        OR NEW.status<>'EXPIRED' AND NEW.snapshot IS DISTINCT FROM OLD.snapshot THEN
        RAISE EXCEPTION 'report export snapshot and identity are immutable' USING ERRCODE='restrict_violation';
    END IF;
    IF NOT ((OLD.status='QUEUED' AND NEW.status='RUNNING') OR (OLD.status='RUNNING' AND NEW.status IN ('SUCCEEDED','FAILED'))
        OR (OLD.status<>'EXPIRED' AND NEW.status='EXPIRED' AND NEW.snapshot IS NULL AND NEW.content IS NULL)) THEN
        RAISE EXCEPTION 'invalid report export transition' USING ERRCODE='restrict_violation';
    END IF;
    RETURN NEW;
END; $$;
CREATE TRIGGER tg_report_export_snapshot BEFORE UPDATE ON report_exports FOR EACH ROW EXECUTE FUNCTION preserve_report_export();
