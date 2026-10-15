-- Disposable digests contain identifiers/counts only; original events and results stay immutable.
CREATE TABLE digest_preferences (
 user_id uuid NOT NULL REFERENCES users(id), workspace_id uuid NOT NULL REFERENCES workspaces(id),
 frequency varchar(8) NOT NULL CHECK(frequency IN ('DAILY','WEEKLY','MUTED')),
 PRIMARY KEY(user_id,workspace_id)
);
CREATE TABLE notification_digests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id),
 workspace_id uuid NOT NULL REFERENCES workspaces(id), membership_id uuid NOT NULL,
 frequency varchar(8) NOT NULL CHECK(frequency IN ('DAILY','WEEKLY')),
 window_start timestamptz NOT NULL, window_end timestamptz NOT NULL, published_at timestamptz NOT NULL,
 UNIQUE(user_id,membership_id,window_start,frequency), CHECK(window_end>window_start)
);
CREATE TABLE digest_seen (
 user_id uuid PRIMARY KEY REFERENCES users(id), seen_at timestamptz NOT NULL
);
CREATE TABLE analysis_parameter_runs (
 workspace_id uuid NOT NULL REFERENCES workspaces(id), parent_analysis_id uuid NOT NULL REFERENCES analyses(id),
 requested_by uuid NOT NULL REFERENCES users(id), idempotency_key uuid NOT NULL,
 request_hash varchar(64) NOT NULL, analysis_id uuid NOT NULL REFERENCES analyses(id), execution_id uuid NOT NULL,
 PRIMARY KEY(workspace_id,parent_analysis_id,requested_by,idempotency_key)
);
CREATE INDEX ix_digests_recipient ON notification_digests(user_id,published_at DESC);
CREATE INDEX ix_digest_events ON notification_outbox(user_id,workspace_id,created_at);
GRANT SELECT,INSERT,UPDATE,DELETE ON digest_preferences,notification_digests,digest_seen,analysis_parameter_runs TO researchhub_erasure;
DO $$ DECLARE body text; BEGIN
 SELECT pg_get_functiondef('finish_account_erasure(uuid)'::regprocedure) INTO body;
 body:=replace(body,'-- Owned payloads and their binary CRDT/export/analysis copies.',
 'DELETE FROM public.notification_digests WHERE workspace_id=ANY(job.workspace_ids) OR user_id=job.user_id;
  DELETE FROM public.digest_preferences WHERE workspace_id=ANY(job.workspace_ids) OR user_id=job.user_id;
  DELETE FROM public.digest_seen WHERE user_id=job.user_id;
  DELETE FROM public.analysis_parameter_runs WHERE workspace_id=ANY(job.workspace_ids) OR requested_by=job.user_id;
  -- Owned payloads and their binary CRDT/export/analysis copies.');
 EXECUTE body;
END $$;
CREATE FUNCTION revoke_digest_projection() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 DELETE FROM notification_digests WHERE workspace_id=OLD.workspace_id AND user_id=OLD.user_id;
 DELETE FROM digest_preferences WHERE workspace_id=OLD.workspace_id AND user_id=OLD.user_id;
 RETURN OLD;
END $$;
CREATE TRIGGER revoke_digest_projection AFTER DELETE ON workspace_members FOR EACH ROW EXECUTE FUNCTION revoke_digest_projection();

ALTER TABLE product_audit_events DROP CONSTRAINT product_audit_events_event_type_check;

ALTER TABLE product_audit_events ADD CHECK(event_type IN (
 'WORKSPACE_CREATED','MEMBER_ADDED','MEMBER_ROLE_CHANGED','MEMBER_REMOVED','SOURCE_UPLOADED','SOURCE_REPROCESSED',
 'DOCUMENT_CREATED','AI_EVIDENCE_REQUESTED','AI_SUGGESTION_ACCEPTED','ANALYSIS_EXECUTED','ANALYSIS_BLOCK_INSERTED',
 'CANVAS_STAGE_COMPLETED','INVITATION_CREATED','INVITATION_ACCEPTED','INVITATION_REVOKED','AUDIT_EXPORTED',
 'COMMENT_CREATED','COMMENT_REPLIED','COMMENT_EDITED','REVIEW_TASK_CREATED','REVIEW_TASK_CHANGED','ANALYSIS_INPUT_CHANGED'));

CREATE UNIQUE INDEX uq_analysis_stale_event ON product_audit_events(resource_id,(metadata->>'sourceVersionId')) WHERE event_type='ANALYSIS_INPUT_CHANGED';
CREATE FUNCTION notify_stale_analysis() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE dependency record; event uuid; BEGIN
 IF NEW.active_version_id=OLD.active_version_id THEN RETURN NEW; END IF;
 FOR dependency IN SELECT DISTINCT i.analysis_id FROM analysis_inputs i
  WHERE i.workspace_id=NEW.workspace_id AND i.source_id=NEW.id AND i.source_version_id<>NEW.active_version_id LOOP
  event:=gen_random_uuid();
  INSERT INTO product_audit_events(id,workspace_id,event_type,resource_type,resource_id,metadata,created_at)
   VALUES(event,NEW.workspace_id,'ANALYSIS_INPUT_CHANGED','ANALYSIS_EXECUTION',dependency.analysis_id,
    jsonb_build_object('analysisId',dependency.analysis_id,'sourceVersionId',NEW.active_version_id),NEW.updated_at)
   ON CONFLICT DO NOTHING;
  IF FOUND THEN
   INSERT INTO notification_outbox(event_id,user_id,membership_id,workspace_id,type,target_type,target_id,created_at,available_at)
   SELECT event,m.user_id,m.id,NEW.workspace_id,'ANALYSIS_STALE','ANALYSIS',dependency.analysis_id,NEW.updated_at,NEW.updated_at
   FROM workspace_members m JOIN users u ON u.id=m.user_id AND u.status='ACTIVE' WHERE m.workspace_id=NEW.workspace_id
   ON CONFLICT DO NOTHING;
  END IF;
 END LOOP;
 RETURN NEW;
END $$;
CREATE TRIGGER notify_stale_analysis AFTER UPDATE OF active_version_id ON sources FOR EACH ROW EXECUTE FUNCTION notify_stale_analysis();
ALTER TABLE notification_preferences DROP CONSTRAINT notification_preferences_type_check;
ALTER TABLE notification_preferences ADD CHECK(type IN ('COMMENT','MENTION','ANALYSIS_COMPLETED','ANALYSIS_FAILED','REVIEW_TASK','ATTENTION','ANALYSIS_STALE'));

CREATE TRIGGER immutable_parameter_run BEFORE UPDATE OR DELETE ON analysis_parameter_runs FOR EACH ROW EXECUTE FUNCTION preserve_ai_authoring_event();
CREATE TRIGGER z_erasure_publication BEFORE INSERT OR UPDATE ON analysis_parameter_runs FOR EACH ROW EXECUTE FUNCTION reject_erased_workspace_publication();
