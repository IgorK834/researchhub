-- A reprocessing run has a new idempotency key. Original job identities and input bytes stay immutable.
ALTER TABLE processing_jobs ADD COLUMN generation integer NOT NULL DEFAULT 0
    CONSTRAINT ck_processing_jobs_generation CHECK (generation >= 0);
ALTER TABLE processing_jobs DROP CONSTRAINT uq_processing_jobs_resource;
ALTER TABLE processing_jobs ADD CONSTRAINT uq_processing_jobs_resource_generation
    UNIQUE (job_type, resource_type, resource_id, generation);

ALTER TABLE source_extractions ADD COLUMN processing_version varchar(128) NOT NULL DEFAULT 'source-ingest-2';
ALTER TABLE source_extractions ADD COLUMN schema_version varchar(16) NOT NULL DEFAULT '2.0';
ALTER TABLE source_extractions ADD COLUMN payload_sha256 varchar(64)
    CHECK (payload_sha256 IS NULL OR payload_sha256 ~ '^[0-9a-f]{64}$');
UPDATE source_extractions SET payload = jsonb_set(payload, '{processingVersion}', to_jsonb(processing_version));

-- Legacy payloads remain readable, with no fabricated preview data.
UPDATE source_extractions SET payload = jsonb_set(
    jsonb_set(payload, '{workbook,previewRowLimit}', '50'::jsonb), '{workbook,sheets}',
    COALESCE((SELECT jsonb_agg(sheet || '{"previewRows":[]}'::jsonb)
              FROM jsonb_array_elements(payload #> '{workbook,sheets}') sheet), '[]'::jsonb))
WHERE jsonb_typeof(payload -> 'workbook') = 'object';

-- Retain small provenance records for successful result deliveries, never a second copy of extracted text.
CREATE TABLE source_extraction_runs (
    job_id uuid PRIMARY KEY REFERENCES processing_jobs(id),
    source_id uuid NOT NULL REFERENCES sources(id),
    workspace_id uuid NOT NULL REFERENCES workspaces(id),
    parser_version varchar(128) NOT NULL,
    processing_version varchar(128) NOT NULL,
    schema_version varchar(16) NOT NULL,
    payload_sha256 varchar(64) CHECK (payload_sha256 IS NULL OR payload_sha256 ~ '^[0-9a-f]{64}$'),
    persisted_at timestamptz NOT NULL
);
INSERT INTO source_extraction_runs(job_id, source_id, workspace_id, parser_version, processing_version, schema_version, persisted_at)
SELECT job_id, source_id, workspace_id, parser_version, processing_version, schema_version, created_at FROM source_extractions;
CREATE INDEX ix_source_extraction_runs_source ON source_extraction_runs(workspace_id, source_id, persisted_at DESC);

CREATE OR REPLACE FUNCTION processing_job_identity_is_immutable() RETURNS trigger
    LANGUAGE plpgsql AS
$$
BEGIN
    IF NEW.id IS DISTINCT FROM OLD.id
        OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
        OR NEW.job_type IS DISTINCT FROM OLD.job_type
        OR NEW.resource_type IS DISTINCT FROM OLD.resource_type
        OR NEW.resource_id IS DISTINCT FROM OLD.resource_id
        OR NEW.created_at IS DISTINCT FROM OLD.created_at
        OR NEW.generation IS DISTINCT FROM OLD.generation THEN
        RAISE EXCEPTION 'processing job identity is immutable for job %', OLD.id
            USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
END;
$$;
