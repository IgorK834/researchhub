-- Private-content-free contextual workflow stages share the append-only product audit.
ALTER TABLE product_audit_events DROP CONSTRAINT product_audit_events_event_type_check;
ALTER TABLE product_audit_events ADD CONSTRAINT product_audit_events_event_type_check CHECK (event_type IN (
 'WORKSPACE_CREATED','MEMBER_ADDED','MEMBER_ROLE_CHANGED','MEMBER_REMOVED','SOURCE_UPLOADED','SOURCE_REPROCESSED',
 'DOCUMENT_CREATED','AI_EVIDENCE_REQUESTED','AI_SUGGESTION_ACCEPTED','ANALYSIS_EXECUTED','ANALYSIS_BLOCK_INSERTED','CANVAS_STAGE_COMPLETED'));
-- Preserve historical v1 exports and admit the controlled math/solution v2 snapshot.
DO $$ DECLARE c record; BEGIN
 FOR c IN SELECT conname FROM pg_constraint WHERE conrelid='report_exports'::regclass
   AND contype='c' AND pg_get_constraintdef(oid) LIKE '%schemaVersion%' LOOP
  EXECUTE format('ALTER TABLE report_exports DROP CONSTRAINT %I',c.conname);
 END LOOP;
END $$;
ALTER TABLE report_exports ADD CONSTRAINT ck_report_snapshot_version CHECK (
 snapshot IS NULL OR snapshot->>'schemaVersion' IN ('1.0','2.0') AND snapshot->>'workspaceId'=workspace_id::text
 AND snapshot->>'documentId'=document_id::text AND (snapshot->>'revision')::bigint=revision);
ALTER TABLE ai_messages DROP CONSTRAINT ai_messages_error_code_check;
ALTER TABLE ai_messages ADD CONSTRAINT ai_messages_error_code_check CHECK (error_code IN (
 'AI_UNAVAILABLE','AI_PROVIDER_ERROR','AI_OUTPUT_INVALID','AI_REFUSED','AI_CONTEXT_TOO_LARGE','VALIDATION_FAILED',
 'FORBIDDEN','RESOURCE_NOT_FOUND','CONFLICT','INTERNAL_ERROR','RATE_LIMIT_EXCEEDED'));
