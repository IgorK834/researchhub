-- Product projections are disposable; audit/provenance remain append-only.
ALTER TABLE document_comments ADD COLUMN revision bigint NOT NULL DEFAULT 1 CHECK(revision > 0);
ALTER TABLE document_comments ADD COLUMN mentions jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(mentions)='array' AND jsonb_array_length(mentions)<=20);
ALTER TABLE comment_replies ADD COLUMN mentions jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(mentions)='array' AND jsonb_array_length(mentions)<=20);
ALTER TABLE comment_audit_events DROP CONSTRAINT comment_audit_events_action_check;
ALTER TABLE comment_audit_events ADD CHECK(action IN ('CREATED','REPLIED','RESOLVED','REOPENED','EDITED'));
ALTER TABLE product_audit_events DROP CONSTRAINT product_audit_events_event_type_check;
ALTER TABLE product_audit_events ADD CHECK(event_type IN (
 'WORKSPACE_CREATED','MEMBER_ADDED','MEMBER_ROLE_CHANGED','MEMBER_REMOVED','SOURCE_UPLOADED','SOURCE_REPROCESSED',
 'DOCUMENT_CREATED','AI_EVIDENCE_REQUESTED','AI_SUGGESTION_ACCEPTED','ANALYSIS_EXECUTED','ANALYSIS_BLOCK_INSERTED',
 'CANVAS_STAGE_COMPLETED','INVITATION_CREATED','INVITATION_ACCEPTED','INVITATION_REVOKED','AUDIT_EXPORTED',
 'COMMENT_CREATED','COMMENT_REPLIED','COMMENT_EDITED','REVIEW_TASK_CREATED','REVIEW_TASK_CHANGED'));
ALTER TABLE product_audit_events DROP CONSTRAINT product_audit_events_resource_type_check;
ALTER TABLE product_audit_events ADD CHECK(resource_type IN ('WORKSPACE','MEMBER','SOURCE','DOCUMENT','AI_SUGGESTION','COMMENT_AI_SUGGESTION','ANALYSIS_EXECUTION','INVITATION','COMMENT','REVIEW_TASK'));

CREATE TABLE review_tasks (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES workspaces(id),
 title varchar(200) NOT NULL CHECK(length(btrim(title))>0), description varchar(4000) NOT NULL,
 target_type varchar(32) NOT NULL CHECK(target_type IN ('COMMENT','DOCUMENT','ANALYSIS','EVIDENCE_FINDING')),
 target_id uuid NOT NULL, document_id uuid, finding_index integer CHECK(finding_index BETWEEN 0 AND 4),
 assignee uuid, unassigned_reason varchar(32),
 status varchar(16) NOT NULL CHECK(status IN ('OPEN','IN_PROGRESS','DONE','CANCELLED')),
 due_at timestamptz, revision bigint NOT NULL CHECK(revision>0), created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL,
 FOREIGN KEY(workspace_id,assignee) REFERENCES workspace_members(workspace_id,user_id) DEFERRABLE INITIALLY DEFERRED,
 CHECK((target_type='COMMENT')=(document_id IS NOT NULL)),
 CHECK((target_type='EVIDENCE_FINDING')=(finding_index IS NOT NULL)),
 CHECK(assignee IS NULL OR unassigned_reason IS NULL)
);
CREATE INDEX ix_review_tasks_page ON review_tasks(workspace_id,created_at DESC,id DESC);
CREATE INDEX ix_review_tasks_mine ON review_tasks(workspace_id,assignee,status,due_at);
CREATE TRIGGER z_erasure_publication BEFORE INSERT OR UPDATE ON review_tasks FOR EACH ROW EXECUTE FUNCTION reject_erased_workspace_publication();

CREATE FUNCTION review_target_exists(scope uuid, kind text, target uuid, doc uuid, finding integer) RETURNS boolean
 LANGUAGE sql STABLE AS $$ SELECT CASE kind
 WHEN 'COMMENT' THEN EXISTS(SELECT 1 FROM document_comments c WHERE c.workspace_id=scope AND c.document_id=doc AND c.id=target)
 WHEN 'DOCUMENT' THEN EXISTS(SELECT 1 FROM documents d WHERE d.workspace_id=scope AND d.id=target)
 WHEN 'ANALYSIS' THEN EXISTS(SELECT 1 FROM analyses a WHERE a.workspace_id=scope AND a.id=target)
 WHEN 'EVIDENCE_FINDING' THEN EXISTS(SELECT 1 FROM ai_source_analyses a WHERE a.workspace_id=scope AND a.id=target
   AND a.payload->'answer'->'findings'->finding IS NOT NULL)
 ELSE false END $$;

CREATE TABLE notification_preferences (
 user_id uuid NOT NULL REFERENCES users(id), workspace_id uuid NOT NULL REFERENCES workspaces(id),
 type varchar(32) NOT NULL CHECK(type IN ('COMMENT','MENTION','ANALYSIS_COMPLETED','ANALYSIS_FAILED','REVIEW_TASK','ATTENTION')),
 muted boolean NOT NULL, PRIMARY KEY(user_id,workspace_id,type)
);
CREATE TABLE notification_outbox (
 event_id uuid NOT NULL REFERENCES product_audit_events(id), user_id uuid NOT NULL REFERENCES users(id),
 membership_id uuid NOT NULL, workspace_id uuid NOT NULL REFERENCES workspaces(id), type varchar(32) NOT NULL,
 target_type varchar(32) NOT NULL, target_id uuid NOT NULL, document_id uuid, reply_id uuid,
 created_at timestamptz NOT NULL, available_at timestamptz NOT NULL, attempts integer NOT NULL DEFAULT 0,
 delivered_at timestamptz, PRIMARY KEY(user_id,event_id)
);
CREATE INDEX ix_notification_outbox_due ON notification_outbox(available_at) WHERE delivered_at IS NULL;
CREATE TABLE notifications (
 id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id), event_id uuid NOT NULL REFERENCES product_audit_events(id),
 membership_id uuid NOT NULL, workspace_id uuid NOT NULL REFERENCES workspaces(id), type varchar(32) NOT NULL,
 target_type varchar(32) NOT NULL, target_id uuid NOT NULL, document_id uuid,
 created_at timestamptz NOT NULL, read_at timestamptz, UNIQUE(user_id,event_id)
);
CREATE INDEX ix_notifications_feed ON notifications(user_id,created_at DESC,id DESC);
CREATE INDEX ix_notifications_unread ON notifications(user_id,created_at DESC) WHERE read_at IS NULL;

-- Snapshot the audience in the original transaction. A newly added member never receives old events.
CREATE FUNCTION enqueue_product_notification() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE kind text; target_kind text; target uuid; doc uuid; BEGIN
 CASE NEW.event_type
 WHEN 'COMMENT_CREATED','COMMENT_REPLIED','COMMENT_EDITED' THEN
  kind:='COMMENT'; target_kind:='COMMENT'; target:=NEW.resource_id; doc:=(NEW.metadata->>'documentId')::uuid;
 WHEN 'ANALYSIS_EXECUTED' THEN
  kind:=CASE WHEN NEW.metadata->>'status'='SUCCEEDED' THEN 'ANALYSIS_COMPLETED' ELSE 'ANALYSIS_FAILED' END;
  target_kind:='ANALYSIS'; target:=(NEW.metadata->>'analysisId')::uuid;
 WHEN 'REVIEW_TASK_CREATED','REVIEW_TASK_CHANGED' THEN kind:='REVIEW_TASK'; target_kind:='REVIEW_TASK'; target:=NEW.resource_id;
 WHEN 'MEMBER_ROLE_CHANGED' THEN kind:='ATTENTION'; target_kind:='WORKSPACE'; target:=NEW.workspace_id;
 ELSE RETURN NEW; END CASE;
 -- Older/partial audit headers remain valid history but cannot produce a resolvable product target.
 IF target IS NULL OR (target_kind='COMMENT' AND doc IS NULL) THEN RETURN NEW; END IF;
 INSERT INTO notification_outbox(event_id,user_id,membership_id,workspace_id,type,target_type,target_id,document_id,reply_id,created_at,available_at)
 SELECT NEW.id,m.user_id,m.id,NEW.workspace_id,
  CASE WHEN kind='COMMENT' AND coalesce(NEW.metadata->'mentions','[]'::jsonb) ? m.user_id::text THEN 'MENTION' ELSE kind END,
  target_kind,target,doc,(NEW.metadata->>'replyId')::uuid,NEW.created_at,NEW.created_at
 FROM workspace_members m JOIN users u ON u.id=m.user_id AND u.status='ACTIVE'
 WHERE m.workspace_id=NEW.workspace_id
 AND (kind IN ('ANALYSIS_COMPLETED','ANALYSIS_FAILED') OR m.user_id IS DISTINCT FROM NEW.actor_user_id)
 AND (NEW.event_type<>'COMMENT_EDITED' OR coalesce(NEW.metadata->'mentions','[]'::jsonb) ? m.user_id::text)
 AND (kind<>'REVIEW_TASK' OR m.user_id=coalesce((NEW.metadata->>'recipientId')::uuid,(SELECT created_by FROM review_tasks WHERE id=target)))
 AND (kind<>'ATTENTION' OR m.user_id=NEW.resource_id)
 ON CONFLICT DO NOTHING;
 RETURN NEW;
END $$;
CREATE TRIGGER product_notification_outbox AFTER INSERT ON product_audit_events FOR EACH ROW EXECUTE FUNCTION enqueue_product_notification();

CREATE FUNCTION revoke_product_projections() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE task record; BEGIN
 DELETE FROM notifications WHERE workspace_id=OLD.workspace_id AND user_id=OLD.user_id;
 DELETE FROM notification_outbox WHERE workspace_id=OLD.workspace_id AND user_id=OLD.user_id;
 DELETE FROM notification_preferences WHERE workspace_id=OLD.workspace_id AND user_id=OLD.user_id;
 FOR task IN UPDATE review_tasks SET assignee=NULL,unassigned_reason='MEMBER_REMOVED',revision=revision+1,updated_at=now()
  WHERE workspace_id=OLD.workspace_id AND assignee=OLD.user_id RETURNING * LOOP
  INSERT INTO product_audit_events(id,workspace_id,event_type,resource_type,resource_id,metadata,created_at)
  VALUES(gen_random_uuid(),OLD.workspace_id,'REVIEW_TASK_CHANGED','REVIEW_TASK',task.id,
   jsonb_build_object('revision',task.revision,'reason','MEMBER_REMOVED','recipientId',task.created_by),now());
 END LOOP;
 RETURN OLD;
END $$;
CREATE TRIGGER revoke_product_projections AFTER DELETE ON workspace_members FOR EACH ROW EXECUTE FUNCTION revoke_product_projections();

-- Join membership identities, not only user ids, so revocation followed by rejoin does not revive a feed.
CREATE VIEW visible_notifications AS
 SELECT n.*,w.name AS workspace_label,
 CASE n.target_type WHEN 'COMMENT' THEN (SELECT d.title FROM documents d WHERE d.workspace_id=n.workspace_id AND d.id=n.document_id)
 WHEN 'REVIEW_TASK' THEN (SELECT t.title FROM review_tasks t WHERE t.workspace_id=n.workspace_id AND t.id=n.target_id)
 ELSE NULL END AS target_label
 FROM notifications n JOIN workspace_members m ON m.id=n.membership_id AND m.user_id=n.user_id AND m.workspace_id=n.workspace_id
 JOIN workspaces w ON w.id=n.workspace_id AND w.erasure_requested_at IS NULL
 JOIN users u ON u.id=n.user_id AND u.status='ACTIVE'
 WHERE CASE WHEN n.target_type='REVIEW_TASK' THEN EXISTS(SELECT 1 FROM review_tasks t WHERE t.workspace_id=n.workspace_id AND t.id=n.target_id
  AND review_target_exists(t.workspace_id,t.target_type,t.target_id,t.document_id,t.finding_index))
 WHEN n.target_type='WORKSPACE' THEN true
 ELSE review_target_exists(n.workspace_id,n.target_type,n.target_id,n.document_id,NULL) END;

GRANT SELECT,INSERT,UPDATE,DELETE ON review_tasks,notifications,notification_outbox,notification_preferences TO researchhub_erasure;
-- Extend the existing terminal erasure function without changing its authority or immutable receipts.
DO $$ DECLARE body text; BEGIN
 SELECT pg_get_functiondef('finish_account_erasure(uuid)'::regprocedure) INTO body;
 body:=replace(body,'-- Owned payloads and their binary CRDT/export/analysis copies.',
 'DELETE FROM public.notifications WHERE workspace_id=ANY(job.workspace_ids) OR user_id=job.user_id;
  DELETE FROM public.notification_outbox WHERE workspace_id=ANY(job.workspace_ids) OR user_id=job.user_id;
  DELETE FROM public.notification_preferences WHERE workspace_id=ANY(job.workspace_ids) OR user_id=job.user_id;
  DELETE FROM public.review_tasks WHERE workspace_id=ANY(job.workspace_ids);
  -- Owned payloads and their binary CRDT/export/analysis copies.');
 EXECUTE body;
END $$;
