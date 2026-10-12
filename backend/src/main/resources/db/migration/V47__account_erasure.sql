-- RH-338: terminal erasure authority. No runtime SET ROLE grant and no trigger disabling.
ALTER TABLE users DROP CONSTRAINT ck_users_status;
ALTER TABLE users ADD CONSTRAINT ck_users_status CHECK(status IN ('ACTIVE','DISABLED','LOCKED','ERASURE_PENDING','ERASED'));
ALTER TABLE workspaces ADD COLUMN erasure_requested_at timestamptz;
ALTER TABLE workspaces ADD COLUMN erased_at timestamptz;
ALTER TABLE account_audit_events DROP CONSTRAINT account_audit_events_event_type_check;
ALTER TABLE account_audit_events ADD CONSTRAINT account_audit_events_event_type_check CHECK(event_type IN (
 'PASSWORD_CHANGED','SESSION_REVOKED','SESSIONS_REVOKED','SESSIONS_VIEWED','PASSWORD_RESET','EMAIL_VERIFIED','ACCOUNT_EXPORTED','ERASURE_REQUESTED','LIVE_DATA_ERASED'));
CREATE TABLE account_erasure_jobs (
 id uuid PRIMARY KEY, user_id uuid NOT NULL UNIQUE REFERENCES users(id),
 receipt_hash varchar(64) NOT NULL, policy_version varchar(64) NOT NULL,
 status varchar(16) NOT NULL CHECK(status IN ('PENDING','RUNNING','SUCCEEDED')),
 requested_at timestamptz NOT NULL, live_erased_at timestamptz,
 attempts integer NOT NULL DEFAULT 0, next_attempt_at timestamptz NOT NULL,
 last_error_code varchar(40), workspace_ids uuid[] NOT NULL,
 CHECK((status='SUCCEEDED')=(live_erased_at IS NOT NULL))
);
CREATE INDEX ix_account_erasure_due ON account_erasure_jobs(next_attempt_at) WHERE status='PENDING';
CREATE TABLE account_erasure_objects (
 job_id uuid NOT NULL REFERENCES account_erasure_jobs(id), storage_key varchar(255) NOT NULL,
 deleted_at timestamptz, hash_classified boolean NOT NULL DEFAULT false, retain_hash boolean NOT NULL DEFAULT false, PRIMARY KEY(job_id,storage_key)
);
-- Only non-content, non-identity headers survive a deleted workspace. Never retain titles/filenames/body hashes.
CREATE TABLE erased_source_versions (
 id uuid PRIMARY KEY, source_id uuid NOT NULL, workspace_id uuid NOT NULL REFERENCES workspaces(id),
 version_number integer NOT NULL, content_sha256 varchar(64), size_bytes bigint NOT NULL,
 source_type varchar(16) NOT NULL, uploaded_by uuid NOT NULL REFERENCES users(id), erased_at timestamptz NOT NULL
);
CREATE TABLE erased_review_audit_events (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES workspaces(id), document_id uuid NOT NULL,
 comment_id uuid NOT NULL, reply_id uuid, actor_id uuid NOT NULL REFERENCES users(id),
 action varchar(16) NOT NULL, previous_status varchar(16), status varchar(16) NOT NULL, created_at timestamptz NOT NULL
);
CREATE TRIGGER erased_source_immutable BEFORE UPDATE OR DELETE ON erased_source_versions FOR EACH ROW EXECUTE FUNCTION review_history_is_immutable();
CREATE TRIGGER erased_review_immutable BEFORE UPDATE OR DELETE ON erased_review_audit_events FOR EACH ROW EXECUTE FUNCTION review_history_is_immutable();

DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='researchhub_erasure') THEN
  CREATE ROLE researchhub_erasure NOLOGIN NOINHERIT;
 END IF;
END $$;
GRANT USAGE,CREATE ON SCHEMA public TO researchhub_erasure;
GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO researchhub_erasure;

-- Delete cycles (canvas receipts/proposals and source active-version pointers) together, checking at commit.
-- Ordinary transactions retain immediate FK enforcement.
DO $$ DECLARE r record; BEGIN
 FOR r IN SELECT conrelid::regclass AS tbl,conname FROM pg_constraint
  WHERE contype='f' AND connamespace='public'::regnamespace AND NOT condeferrable LOOP
  EXECUTE format('ALTER TABLE %s ALTER CONSTRAINT %I DEFERRABLE INITIALLY IMMEDIATE',r.tbl,r.conname);
 END LOOP;
END $$;

-- Preserve each existing trigger body. Only the NOLOGIN definer can take this terminal path.
-- App sessions cannot set a GUC or a flag to acquire erasure authority.
DO $$ DECLARE fn text; body text; BEGIN
 FOREACH fn IN ARRAY ARRAY['review_history_is_immutable','document_versions_are_immutable','source_version_input_is_immutable',
  'preserve_ai_authoring_event','reject_external_evidence_mutation','preserve_execution_attempt','protect_problem_intent',
  'protect_problem_execution','preserve_canvas_receipt','preserve_analysis_identity'] LOOP
  SELECT pg_get_functiondef((('public.'||fn||'()')::regprocedure)::oid) INTO body;
  body:=regexp_replace(body,'\mBEGIN\M',$guard$BEGIN
   IF current_user='researchhub_erasure' AND TG_OP='DELETE' THEN RETURN OLD; END IF;
   IF current_user='researchhub_erasure' AND TG_OP='UPDATE'
     AND TG_TABLE_NAME IN ('document_versions','document_content_operations','comment_audit_events')
     AND (to_jsonb(NEW)-'actor_name')=(to_jsonb(OLD)-'actor_name') AND to_jsonb(NEW)->>'actor_name'='Deleted account'
     THEN RETURN NEW; END IF;
   IF current_user='researchhub_erasure' AND TG_OP='UPDATE' AND TG_TABLE_NAME='comment_replies'
     AND (to_jsonb(NEW)-'author_name')=(to_jsonb(OLD)-'author_name') AND to_jsonb(NEW)->>'author_name'='Deleted account'
     THEN RETURN NEW; END IF;
  $guard$,'i');
  EXECUTE body;
 END LOOP;
END $$;

CREATE FUNCTION reject_erased_workspace_publication() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE scope uuid; tombstone timestamptz; actor uuid; actor_field text; actor_status text; BEGIN
 IF current_user='researchhub_erasure' THEN RETURN NEW; END IF;
 FOREACH actor_field IN ARRAY ARRAY['created_by','author_id','caller_id','actor_user_id','requested_by','uploaded_by','searched_by','recorded_by','invited_by','accepted_by'] LOOP
  actor:=(to_jsonb(NEW)->>actor_field)::uuid;
  IF actor IS NOT NULL THEN
   SELECT status INTO actor_status FROM users WHERE id=actor FOR SHARE;
   IF actor_status IN ('ERASURE_PENDING','ERASED') THEN RAISE EXCEPTION 'Actor is pending erasure' USING ERRCODE='restrict_violation'; END IF;
  END IF;
 END LOOP;
 scope:=(to_jsonb(NEW)->>'workspace_id')::uuid;
 IF scope IS NULL AND TG_TABLE_NAME IN ('document_versions','collaboration_documents') THEN
  SELECT workspace_id INTO scope FROM documents WHERE id=(to_jsonb(NEW)->>'document_id')::uuid;
 ELSIF scope IS NULL AND TG_TABLE_NAME='processing_job_source_versions' THEN
  SELECT workspace_id INTO scope FROM processing_jobs WHERE id=NEW.job_id;
 ELSIF scope IS NULL AND TG_TABLE_NAME='ai_source_analysis_sources' THEN
  SELECT workspace_id INTO scope FROM ai_source_analyses WHERE id=NEW.analysis_id;
 ELSIF scope IS NULL AND TG_TABLE_NAME='comment_ai_citation_acceptances' THEN
  SELECT workspace_id INTO scope FROM comment_ai_suggestions WHERE id=NEW.suggestion_id;
 END IF;
 -- SHARE serializes publication with the request's workspace tombstone update.
 SELECT erasure_requested_at INTO tombstone FROM workspaces WHERE id=scope FOR SHARE;
 IF tombstone IS NOT NULL THEN RAISE EXCEPTION 'Workspace is pending erasure' USING ERRCODE='restrict_violation'; END IF;
 RETURN NEW;
END $$;
DO $$ DECLARE tbl text; BEGIN
 FOREACH tbl IN ARRAY ARRAY['workspace_members','documents','document_versions','sources','source_versions','processing_jobs',
 'source_extractions','source_extraction_runs','source_retrieval_sets','source_retrieval_chunks','source_chunk_embeddings',
 'ai_generation_runs','ai_conversations','ai_messages','ai_authoring_suggestions','ai_authoring_events','ai_source_analyses',
 'processing_job_source_versions','source_version_extractions','source_version_retrieval_sets','ai_source_analysis_sources',
 'analyses','analysis_inputs','analysis_plan_attempts','analysis_executions','analysis_execution_artifacts','analysis_execution_records',
 'analysis_origins','collaboration_documents','collaboration_credentials','document_comments','comment_replies','comment_audit_events',
 'product_audit_events','comment_ai_suggestions','comment_ai_citation_acceptances','document_content_operations','ai_usage_events',
 'ai_rag_traces','report_exports','external_source_searches','external_source_references','canvas_contexts','canvas_turns',
 'canvas_proposals','canvas_operations','analysis_problems','problem_executions','problem_artifacts','workspace_invitation'] LOOP
  EXECUTE format('CREATE TRIGGER z_erasure_publication BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION reject_erased_workspace_publication()',tbl);
 END LOOP;
END $$;

CREATE TRIGGER z_erasure_workspace_creation BEFORE INSERT ON workspaces FOR EACH ROW EXECUTE FUNCTION reject_erased_workspace_publication();
CREATE FUNCTION preserve_workspace_erasure_tombstone() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF current_user<>'researchhub_erasure' AND OLD.erasure_requested_at IS NOT NULL THEN
  RAISE EXCEPTION 'Workspace is pending erasure' USING ERRCODE='restrict_violation'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER z_workspace_erasure BEFORE UPDATE ON workspaces FOR EACH ROW EXECUTE FUNCTION preserve_workspace_erasure_tombstone();

CREATE FUNCTION finish_account_erasure(request_id uuid) RETURNS void LANGUAGE plpgsql
 SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE job public.account_erasure_jobs%ROWTYPE; identity public.users%ROWTYPE; tbl text; erased_email text; BEGIN
 SELECT * INTO job FROM public.account_erasure_jobs WHERE id=request_id FOR UPDATE;
 IF NOT FOUND OR job.status<>'RUNNING' THEN RAISE EXCEPTION 'Erasure job is not running'; END IF;
 IF EXISTS(SELECT 1 FROM public.account_erasure_objects WHERE job_id=request_id AND deleted_at IS NULL) THEN
  RAISE EXCEPTION 'Erasure storage reconciliation is incomplete'; END IF;
 SELECT * INTO identity FROM public.users WHERE id=job.user_id FOR UPDATE;
 IF identity.status<>'ERASURE_PENDING' THEN RAISE EXCEPTION 'Account is not tombstoned'; END IF;
 IF EXISTS(SELECT 1 FROM public.workspace_members WHERE workspace_id=ANY(job.workspace_ids) AND user_id<>job.user_id)
  OR EXISTS(SELECT 1 FROM public.workspaces WHERE id=ANY(job.workspace_ids) AND erasure_requested_at IS NULL)
 THEN RAISE EXCEPTION 'Erasure workspace scope changed'; END IF;
 SET CONSTRAINTS ALL DEFERRED;
 INSERT INTO public.erased_source_versions
  SELECT v.id,v.source_id,v.workspace_id,v.version_number,
   CASE WHEN o.hash_classified AND o.retain_hash THEN v.content_sha256 ELSE NULL END,
   v.size_bytes,v.source_type,v.uploaded_by,now()
  FROM public.source_versions v JOIN public.account_erasure_objects o ON o.job_id=request_id AND o.storage_key=v.storage_key
  WHERE v.workspace_id=ANY(job.workspace_ids) ON CONFLICT DO NOTHING;
 INSERT INTO public.erased_review_audit_events
  SELECT id,workspace_id,document_id,comment_id,reply_id,actor_id,action,previous_status,status,created_at
  FROM public.comment_audit_events WHERE workspace_id=ANY(job.workspace_ids) ON CONFLICT DO NOTHING;
 -- Owned payloads and their binary CRDT/export/analysis copies. Keep safe product/account history.
 DELETE FROM public.document_versions WHERE document_id IN (SELECT id FROM public.documents WHERE workspace_id=ANY(job.workspace_ids));
 DELETE FROM public.collaboration_documents WHERE document_id IN (SELECT id FROM public.documents WHERE workspace_id=ANY(job.workspace_ids));
 DELETE FROM public.processing_job_source_versions WHERE job_id IN (SELECT id FROM public.processing_jobs WHERE workspace_id=ANY(job.workspace_ids));
 DELETE FROM public.ai_source_analysis_sources WHERE analysis_id IN (SELECT id FROM public.ai_source_analyses WHERE workspace_id=ANY(job.workspace_ids));
 DELETE FROM public.comment_ai_citation_acceptances WHERE suggestion_id IN (SELECT id FROM public.comment_ai_suggestions WHERE workspace_id=ANY(job.workspace_ids));
 FOREACH tbl IN ARRAY ARRAY['source_chunk_embeddings','source_retrieval_chunks','source_retrieval_sets','source_version_retrieval_sets',
  'source_extractions','source_version_extractions','source_extraction_runs','processing_jobs','sources','source_versions',
  'ai_messages','ai_conversations','ai_authoring_events','ai_authoring_suggestions','ai_source_analyses','ai_generation_runs',
  'analysis_execution_artifacts','analysis_execution_records','analysis_origins','analysis_executions','analysis_inputs',
  'analysis_plan_attempts','problem_artifacts','problem_executions','analysis_problems','analyses','collaboration_credentials',
  'document_content_operations','comment_audit_events','comment_replies','comment_ai_suggestions','document_comments',
  'report_exports','documents','ai_usage_events','ai_rag_traces','external_source_references','external_source_searches',
  'canvas_operations','canvas_proposals','canvas_turns','canvas_contexts','workspace_invitation'] LOOP
  EXECUTE format('DELETE FROM public.%I WHERE workspace_id=ANY($1)',tbl) USING job.workspace_ids;
 END LOOP;
 -- Identity snapshots in retained history are terminally pseudonymised, never replaced with a new live author.
 UPDATE public.document_versions SET actor_name='Deleted account' WHERE created_by=job.user_id AND actor_name IS NOT NULL;
 UPDATE public.document_content_operations SET actor_name='Deleted account' WHERE actor_user_id=job.user_id;
 UPDATE public.comment_audit_events SET actor_name='Deleted account' WHERE actor_id=job.user_id;
 UPDATE public.comment_replies SET author_name='Deleted account' WHERE author_id=job.user_id;
 UPDATE public.document_comments SET author_name='Deleted account' WHERE author_id=job.user_id;
 DELETE FROM public.workspace_invitation WHERE email_normalized=identity.normalized_email OR invited_by=job.user_id;
 DELETE FROM public.account_lifecycle_token WHERE email_normalized=identity.normalized_email;
 DELETE FROM public.spring_session WHERE principal_name=job.user_id::text;
 DELETE FROM public.collaboration_credentials WHERE user_id=job.user_id;
 DELETE FROM public.workspace_members WHERE user_id=job.user_id;
 DELETE FROM public.cost_quota_bucket WHERE (scope_type='USER' AND scope_id=job.user_id) OR (scope_type='WORKSPACE' AND scope_id=ANY(job.workspace_ids));
 -- Low entropy email-derived limiter keys must be removed too, including reset/verification requests.
 DELETE FROM public.security_operation_bucket WHERE subject_hash IN (encode(sha256(convert_to(identity.normalized_email,'UTF8')),'hex'),encode(sha256(convert_to('email:'||identity.normalized_email,'UTF8')),'hex'),encode(sha256(convert_to(job.user_id::text,'UTF8')),'hex'));
 UPDATE public.workspaces SET name='Erased workspace',description=NULL,erased_at=now(),updated_at=now() WHERE id=ANY(job.workspace_ids);
 -- Random tombstone email cannot be pre-registered from a known actor UUID to block erasure.
 erased_email:='erased-'||gen_random_uuid()::text||'@users.invalid';
 UPDATE public.users SET email=erased_email,normalized_email=erased_email,
  password_hash='!ERASED!',display_name='Deleted account',status='ERASED',email_verified_at=NULL,updated_at=now() WHERE id=job.user_id;
 INSERT INTO public.account_audit_events VALUES(gen_random_uuid(),job.user_id,'LIVE_DATA_ERASED',now());
 DELETE FROM public.account_erasure_objects WHERE job_id=request_id;
 UPDATE public.account_erasure_jobs SET status='SUCCEEDED',live_erased_at=now(),last_error_code=NULL WHERE id=request_id;
END $$;
-- Only this function executes as the maintenance identity. It cannot be assumed by the web application.
DO $$ BEGIN
 EXECUTE format('GRANT researchhub_erasure TO %I',current_user);
 ALTER FUNCTION finish_account_erasure(uuid) OWNER TO researchhub_erasure;
 REVOKE CREATE ON SCHEMA public FROM researchhub_erasure;
 EXECUTE format('REVOKE researchhub_erasure FROM %I',current_user);
 REVOKE ALL ON FUNCTION finish_account_erasure(uuid) FROM PUBLIC;
 EXECUTE format('GRANT EXECUTE ON FUNCTION finish_account_erasure(uuid) TO %I',current_user);
END $$;

-- Offline restore only. An operator replays authenticated erasure-ledger blobs before enabling traffic.
-- The runtime role gets no public restore endpoint and must not receive EXECUTE on this authority.
CREATE FUNCTION replay_account_erasure(request_id uuid,actor uuid,scopes uuid[],accepted_at timestamptz) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.users WHERE id=actor) THEN RETURN; END IF;
 IF EXISTS(SELECT 1 FROM public.account_erasure_jobs WHERE id=request_id AND user_id<>actor) THEN
  RAISE EXCEPTION 'Restored erasure receipt conflicts with authority'; END IF;
 INSERT INTO public.account_erasure_jobs(id,user_id,receipt_hash,policy_version,status,requested_at,next_attempt_at,workspace_ids)
 VALUES(request_id,actor,encode(sha256(convert_to(gen_random_uuid()::text||gen_random_uuid()::text,'UTF8')),'hex'),'ADR-014/live-erasure-v1','PENDING',accepted_at,now(),scopes)
 ON CONFLICT(user_id) DO UPDATE SET status='PENDING',live_erased_at=NULL,next_attempt_at=now(),workspace_ids=EXCLUDED.workspace_ids;
 UPDATE public.workspaces SET erasure_requested_at=accepted_at WHERE id=ANY(scopes);
 DELETE FROM public.workspace_members WHERE workspace_id=ANY(scopes) AND user_id<>actor;
 DELETE FROM public.collaboration_credentials WHERE workspace_id=ANY(scopes) OR user_id=actor;
 UPDATE public.collaboration_documents SET epoch=epoch+1 WHERE document_id IN (SELECT id FROM public.documents WHERE workspace_id=ANY(scopes));
 DELETE FROM public.spring_session WHERE principal_name=actor::text;
 UPDATE public.users SET status='ERASURE_PENDING' WHERE id=actor;
 INSERT INTO public.account_erasure_objects(job_id,storage_key)
  SELECT j.id,v.storage_key FROM public.account_erasure_jobs j JOIN public.source_versions v ON v.workspace_id=ANY(scopes)
  WHERE j.user_id=actor ON CONFLICT(job_id,storage_key) DO UPDATE SET deleted_at=NULL;
END $$;
DO $$ BEGIN
 EXECUTE format('GRANT researchhub_erasure TO %I',current_user);
 GRANT CREATE ON SCHEMA public TO researchhub_erasure;
 ALTER FUNCTION replay_account_erasure(uuid,uuid,uuid[],timestamptz) OWNER TO researchhub_erasure;
 REVOKE CREATE ON SCHEMA public FROM researchhub_erasure;
 EXECUTE format('REVOKE researchhub_erasure FROM %I',current_user);
 REVOKE ALL ON FUNCTION replay_account_erasure(uuid,uuid,uuid[],timestamptz) FROM PUBLIC;
 EXECUTE format('GRANT EXECUTE ON FUNCTION replay_account_erasure(uuid,uuid,uuid[],timestamptz) TO %I',current_user);
END $$;
