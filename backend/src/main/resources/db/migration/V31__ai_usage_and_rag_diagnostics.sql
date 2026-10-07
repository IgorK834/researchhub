-- Economic telemetry never contains prompt/source text. Null usage/cost means unknown, never zero.
CREATE TABLE ai_usage_events (
    request_id uuid PRIMARY KEY,
    workspace_id uuid NOT NULL REFERENCES workspaces(id),
    feature varchar(32) NOT NULL CHECK (feature IN ('ASK_WORKSPACE','SECTION_GENERATION','REWRITE','EVIDENCE_SEARCH','SOURCE_ANALYSIS','ANALYSIS_PLANNING','GROUNDED_RESPONSE')),
    provider varchar(128), model varchar(128), model_version varchar(128), template_id varchar(128) NOT NULL,
    status varchar(16) NOT NULL CHECK (status IN ('SUCCEEDED','FAILED')),
    input_tokens bigint CHECK (input_tokens BETWEEN 0 AND 20000000),
    output_tokens bigint CHECK (output_tokens BETWEEN 0 AND 20000000),
    usage_estimated boolean, latency_ms bigint NOT NULL CHECK (latency_ms>=0),
    cost_usd numeric(24,10) CHECK (cost_usd>=0), started_at timestamptz NOT NULL,
    details jsonb NOT NULL CHECK (jsonb_typeof(details)='object' AND octet_length(details::text)<=16384),
    CHECK ((input_tokens IS NULL AND output_tokens IS NULL AND usage_estimated IS NULL AND cost_usd IS NULL)
        OR (input_tokens IS NOT NULL AND output_tokens IS NOT NULL AND usage_estimated IS NOT NULL))
);
CREATE INDEX ix_ai_usage_workspace_time ON ai_usage_events(workspace_id,started_at);
-- Optional private query/answer capture; source text is resolved through authorized immutable chunk reads.
CREATE TABLE ai_rag_traces (
    id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES workspaces(id), started_at timestamptz NOT NULL,
    details jsonb NOT NULL CHECK (jsonb_typeof(details)='object' AND octet_length(details::text)<=524288)
);
CREATE INDEX ix_ai_rag_workspace_time ON ai_rag_traces(workspace_id,started_at DESC,id DESC);
