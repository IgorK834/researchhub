-- Bounded AI-owned call trace. Input text and unsafe provider errors are never persisted here.
CREATE TABLE ai_generation_runs (
    request_id uuid PRIMARY KEY,
    workspace_id uuid NOT NULL REFERENCES workspaces(id),
    caller_id uuid NOT NULL REFERENCES users(id),
    feature_id varchar(128) NOT NULL,
    template_id varchar(128) NOT NULL,
    template_hash varchar(64) NOT NULL CHECK (template_hash ~ '^[0-9a-f]{64}$'),
    request_hash varchar(64) NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
    parameters jsonb NOT NULL CHECK (jsonb_typeof(parameters) = 'object' AND octet_length(parameters::text) <= 1024),
    evidence jsonb NOT NULL CHECK (jsonb_typeof(evidence) = 'array' AND jsonb_array_length(evidence) <= 12 AND octet_length(evidence::text) <= 262144),
    status varchar(16) NOT NULL CHECK (status IN ('REQUESTED', 'SUCCEEDED', 'FAILED')),
    response jsonb CHECK (jsonb_typeof(response) = 'object' AND octet_length(response::text) <= 524288),
    error_code varchar(32),
    created_at timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz,
    CHECK ((status = 'REQUESTED' AND response IS NULL AND error_code IS NULL AND completed_at IS NULL)
        OR (status = 'SUCCEEDED' AND response IS NOT NULL AND error_code IS NULL AND completed_at IS NOT NULL)
        OR (status = 'FAILED' AND response IS NULL AND error_code IS NOT NULL AND completed_at IS NOT NULL)),
    CHECK (error_code IS NULL OR error_code IN ('AI_UNAVAILABLE','AI_PROVIDER_ERROR','AI_OUTPUT_INVALID','AI_REFUSED','FORBIDDEN','RESOURCE_NOT_FOUND','CONFLICT'))
);
CREATE INDEX ix_ai_generation_workspace ON ai_generation_runs(workspace_id, request_id);
