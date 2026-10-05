-- Latest-input reruns own a new immutable intent, even when planning fails before execution.
CREATE TABLE analysis_origins (
    analysis_id uuid PRIMARY KEY,
    workspace_id uuid NOT NULL,
    origin_analysis_id uuid NOT NULL,
    origin_execution_id uuid NOT NULL,
    payload jsonb NOT NULL CHECK (jsonb_typeof(payload)='object' AND octet_length(payload::text)<=16384
        AND payload->>'inputMode'='LATEST' AND payload->>'originAnalysisId'=origin_analysis_id::text
        AND payload->>'originExecutionId'=origin_execution_id::text
        AND jsonb_typeof(payload->'versions')='array' AND jsonb_array_length(payload->'versions') BETWEEN 1 AND 5),
    created_at timestamptz NOT NULL,
    CHECK (analysis_id<>origin_analysis_id),
    FOREIGN KEY(workspace_id,analysis_id) REFERENCES analyses(workspace_id,id),
    FOREIGN KEY(workspace_id,origin_analysis_id,origin_execution_id) REFERENCES analysis_executions(workspace_id,analysis_id,id)
);
CREATE TRIGGER tg_analysis_origin_immutable BEFORE UPDATE OR DELETE ON analysis_origins
    FOR EACH ROW EXECUTE FUNCTION preserve_ai_authoring_event();
