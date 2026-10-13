-- RH-347: freeze the selected bundled citation style with each immutable export job.
ALTER TABLE report_exports
    -- Existing v1/v2 snapshots used the numeric IEEE-like renderer.
    ADD COLUMN citation_style varchar(16) NOT NULL DEFAULT 'IEEE',
    ADD CONSTRAINT ck_report_exports_citation_style CHECK (citation_style IN ('APA_7', 'IEEE'));
ALTER TABLE report_exports ALTER COLUMN citation_style DROP DEFAULT;

CREATE OR REPLACE FUNCTION preserve_report_export() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
        OR NEW.document_id IS DISTINCT FROM OLD.document_id OR NEW.requested_by IS DISTINCT FROM OLD.requested_by
        OR NEW.revision IS DISTINCT FROM OLD.revision OR NEW.format IS DISTINCT FROM OLD.format
        OR NEW.citation_style IS DISTINCT FROM OLD.citation_style
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

ALTER TABLE report_exports DROP CONSTRAINT ck_report_snapshot_version;
ALTER TABLE report_exports ADD CONSTRAINT ck_report_snapshot_version CHECK (
    snapshot IS NULL OR snapshot->>'schemaVersion' IN ('1.0','2.0','3.0')
    AND snapshot->>'workspaceId'=workspace_id::text
    AND snapshot->>'documentId'=document_id::text
    AND (snapshot->>'revision')::bigint=revision
    AND CASE WHEN snapshot->>'schemaVersion'='3.0'
        THEN coalesce(snapshot->>'citationStyle'=citation_style, false) ELSE true END);

-- RH-348: Crossref lookups have an independent user/workspace budget.
ALTER TABLE cost_quota_bucket DROP CONSTRAINT cost_quota_bucket_category_check;
ALTER TABLE cost_quota_bucket ADD CONSTRAINT cost_quota_bucket_category_check
    CHECK (category IN ('LLM', 'ANALYSIS', 'RETRIEVAL', 'METADATA_LOOKUP'));
