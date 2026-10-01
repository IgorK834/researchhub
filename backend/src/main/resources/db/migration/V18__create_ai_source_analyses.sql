-- Read-only interpretations retain their exact model/context/citation provenance.
CREATE TABLE ai_source_analyses (
    id uuid PRIMARY KEY,
    workspace_id uuid NOT NULL REFERENCES workspaces(id),
    created_by uuid NOT NULL REFERENCES users(id),
    kind varchar(20) NOT NULL CHECK (kind IN ('COMPARISON','DISAGREEMENTS')),
    parent_comparison_id uuid,
    payload jsonb NOT NULL CHECK (jsonb_typeof(payload)='object' AND octet_length(payload::text)<=262144),
    created_at timestamptz NOT NULL,
    UNIQUE (workspace_id,id),
    FOREIGN KEY (workspace_id,parent_comparison_id) REFERENCES ai_source_analyses(workspace_id,id),
    CHECK ((kind='DISAGREEMENTS') = (parent_comparison_id IS NOT NULL))
);
CREATE INDEX ix_source_analysis_workspace ON ai_source_analyses(workspace_id,created_at DESC);
CREATE TRIGGER tg_ai_source_analyses_immutable BEFORE UPDATE OR DELETE ON ai_source_analyses
    FOR EACH ROW EXECUTE FUNCTION preserve_ai_authoring_event();
