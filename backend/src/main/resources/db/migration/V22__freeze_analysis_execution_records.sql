-- RH-150: a self-contained immutable record for every attempt, including pre-existing v1 results.
CREATE TABLE analysis_execution_records (
    execution_id uuid PRIMARY KEY,
    analysis_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot)='object' AND octet_length(snapshot::text)<=2097152
        AND snapshot ?& ARRAY['userPrompt','plan','inputs'] AND jsonb_typeof(snapshot->'plan')='object'
        AND jsonb_typeof(snapshot->'inputs')='array' AND jsonb_array_length(snapshot->'inputs') BETWEEN 1 AND 5),
    created_at timestamptz NOT NULL,
    FOREIGN KEY(workspace_id,analysis_id,execution_id) REFERENCES analysis_executions(workspace_id,analysis_id,id)
);

-- Copy immutable accepted intent and historical version metadata; never consult the active source version or
-- rerun old code. Axis/series metadata did not exist in v1 and is deliberately not invented during migration.
INSERT INTO analysis_execution_records(execution_id,analysis_id,workspace_id,snapshot,created_at)
SELECT e.id,e.analysis_id,e.workspace_id,jsonb_build_object('userPrompt',a.user_prompt,'plan',a.plan,'inputs',
    (SELECT jsonb_agg(jsonb_build_object('sourceId',v.source_id,'sourceVersionId',v.id,'versionNumber',v.version_number,
        'originalFilename',v.original_filename,'format',v.source_type,'sizeBytes',v.size_bytes,'sha256',v.content_sha256,
        'sheets',coalesce((SELECT jsonb_agg(jsonb_build_object('name',p.value->>'sheetName','columns',
            (SELECT jsonb_agg(jsonb_build_object('index',c.value,'label',
                (SELECT col.value->>'name' FROM jsonb_array_elements(pa.payload->'request'->'inputs') inspected,
                    jsonb_array_elements(inspected->'preview'->'sheets') sheet,
                    jsonb_array_elements(sheet->'columns') col(value)
                 WHERE inspected->'preview'->>'sourceVersionId'=v.id::text AND sheet->>'name'=p.value->>'sheetName'
                    AND col.value->'index'=c.value LIMIT 1)) ORDER BY c.ordinality)
             FROM jsonb_array_elements(p.value->'requiredColumns') WITH ORDINALITY c(value,ordinality))) ORDER BY p.ordinality)
            FROM jsonb_array_elements(a.plan->'inputs') WITH ORDINALITY p(value,ordinality)
            WHERE p.value->>'sourceVersionId'=v.id::text),'[]'::jsonb)) ORDER BY i.ordinal)
     FROM analysis_inputs i JOIN source_versions v ON v.id=i.source_version_id
     WHERE i.analysis_id=a.id)),e.created_at
FROM analysis_executions e JOIN analyses a ON a.id=e.analysis_id
JOIN analysis_plan_attempts pa ON pa.id=a.plan_id;

CREATE FUNCTION validate_analysis_execution_record() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE intent analyses%ROWTYPE;
BEGIN
    SELECT * INTO intent FROM analyses WHERE id=NEW.analysis_id AND workspace_id=NEW.workspace_id;
    IF NEW.snapshot->>'userPrompt' IS DISTINCT FROM intent.user_prompt OR NEW.snapshot->'plan' IS DISTINCT FROM intent.plan
        OR jsonb_array_length(NEW.snapshot->'inputs')<>(SELECT count(*) FROM analysis_inputs WHERE analysis_id=NEW.analysis_id)
        OR (SELECT count(DISTINCT i->>'sourceVersionId') FROM jsonb_array_elements(NEW.snapshot->'inputs') i)
            <>jsonb_array_length(NEW.snapshot->'inputs')
        OR EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.snapshot->'inputs') i WHERE NOT EXISTS (
            SELECT 1 FROM analysis_inputs ai JOIN source_versions v ON v.id=ai.source_version_id
            WHERE ai.analysis_id=NEW.analysis_id AND i->>'sourceId'=v.source_id::text AND i->>'sourceVersionId'=v.id::text
                AND i->>'sha256'=v.content_sha256 AND i->>'format'=v.source_type
                AND i->>'originalFilename'=v.original_filename AND (i->>'versionNumber')::integer=v.version_number
                AND (i->>'sizeBytes')::bigint=v.size_bytes)) THEN
        RAISE EXCEPTION 'execution record must preserve accepted intent and exact input versions' USING ERRCODE='restrict_violation';
    END IF;
    RETURN NEW;
END; $$;
CREATE TRIGGER tg_execution_record_valid BEFORE INSERT ON analysis_execution_records
    FOR EACH ROW EXECUTE FUNCTION validate_analysis_execution_record();
CREATE TRIGGER tg_execution_record_immutable BEFORE UPDATE OR DELETE ON analysis_execution_records
    FOR EACH ROW EXECUTE FUNCTION preserve_ai_authoring_event();
