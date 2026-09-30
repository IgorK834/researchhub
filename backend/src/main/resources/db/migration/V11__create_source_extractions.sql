-- One current, versioned extraction for each immutable source. Application-level JSON contract is validated
-- before persistence. Spring owns this table; the worker has no database access.
CREATE TABLE source_extractions (
    source_id uuid PRIMARY KEY REFERENCES sources(id),
    workspace_id uuid NOT NULL REFERENCES workspaces(id),
    job_id uuid NOT NULL REFERENCES processing_jobs(id),
    parser_version varchar(128) NOT NULL,
    content_sha256 varchar(64) NOT NULL CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
    payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
    created_at timestamptz NOT NULL
);
CREATE INDEX ix_source_extractions_workspace ON source_extractions(workspace_id, source_id);
