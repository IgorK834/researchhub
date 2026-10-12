ALTER TABLE product_audit_events DROP CONSTRAINT product_audit_events_event_type_check;
ALTER TABLE product_audit_events ADD CONSTRAINT product_audit_events_event_type_check CHECK (event_type IN (
 'WORKSPACE_CREATED','MEMBER_ADDED','MEMBER_ROLE_CHANGED','MEMBER_REMOVED','SOURCE_UPLOADED','SOURCE_REPROCESSED',
 'DOCUMENT_CREATED','AI_EVIDENCE_REQUESTED','AI_SUGGESTION_ACCEPTED','ANALYSIS_EXECUTED','ANALYSIS_BLOCK_INSERTED',
 'CANVAS_STAGE_COMPLETED','INVITATION_CREATED','INVITATION_ACCEPTED','INVITATION_REVOKED','AUDIT_EXPORTED'));
CREATE INDEX ix_comment_audit_workspace_time ON comment_audit_events(workspace_id,created_at,id);
CREATE INDEX ix_ai_generation_workspace_time ON ai_generation_runs(workspace_id,created_at,request_id);
