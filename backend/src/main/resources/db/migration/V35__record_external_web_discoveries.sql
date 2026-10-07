-- External web snapshots deliberately have no FK to uploaded source versions/retrieval chunks.
-- A recorded discovery is a reference, never a silently eligible workspace/report citation.
CREATE TABLE external_source_searches (
    id uuid PRIMARY KEY,
    workspace_id uuid NOT NULL REFERENCES workspaces(id),
    searched_by uuid NOT NULL REFERENCES users(id),
    payload jsonb NOT NULL,
    searched_at timestamptz NOT NULL,
    UNIQUE (workspace_id, id),
    CHECK ((jsonb_typeof(payload) = 'object' AND payload->>'evidenceType' = 'EXTERNAL_WEB'
           AND payload->>'id' = id::text AND payload->>'workspaceId' = workspace_id::text
           AND jsonb_typeof(payload->'results') = 'array' AND jsonb_array_length(payload->'results') <= 10) IS TRUE)
);
CREATE TABLE external_source_references (
    id uuid PRIMARY KEY,
    workspace_id uuid NOT NULL REFERENCES workspaces(id),
    search_id uuid NOT NULL,
    result_id uuid NOT NULL,
    recorded_by uuid NOT NULL REFERENCES users(id),
    payload jsonb NOT NULL,
    recorded_at timestamptz NOT NULL,
    FOREIGN KEY (workspace_id, search_id) REFERENCES external_source_searches(workspace_id, id),
    UNIQUE (workspace_id, search_id, result_id),
    CHECK ((jsonb_typeof(payload) = 'object' AND payload->>'evidenceType' = 'EXTERNAL_WEB'
           AND payload->>'id' = id::text AND payload->>'workspaceId' = workspace_id::text
           AND payload->>'snapshotSha256' ~ '^[0-9a-f]{64}$') IS TRUE)
);
CREATE INDEX ix_external_references_workspace ON external_source_references(workspace_id, recorded_at DESC, id DESC);
CREATE FUNCTION reject_external_evidence_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'External evidence snapshots are immutable';
END;
$$;
CREATE TRIGGER external_search_immutable BEFORE UPDATE OR DELETE ON external_source_searches
    FOR EACH ROW EXECUTE FUNCTION reject_external_evidence_mutation();
CREATE TRIGGER external_reference_immutable BEFORE UPDATE OR DELETE ON external_source_references
    FOR EACH ROW EXECUTE FUNCTION reject_external_evidence_mutation();
