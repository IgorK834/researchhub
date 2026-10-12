-- Additive workload: empty dataset inputs are permitted only for PROBLEM.
ALTER TABLE analyses ADD COLUMN workload varchar(8) NOT NULL DEFAULT 'DATASET' CHECK(workload IN ('DATASET','PROBLEM'));
ALTER TABLE analyses DROP CONSTRAINT analyses_inputs_check;
ALTER TABLE analyses ADD CONSTRAINT analyses_inputs_check CHECK(jsonb_typeof(inputs)='array' AND octet_length(inputs::text)<=16384 AND
 ((workload='DATASET' AND jsonb_array_length(inputs) BETWEEN 1 AND 5) OR (workload='PROBLEM' AND inputs='[]'::jsonb)));
CREATE TABLE analysis_problems (
 analysis_id uuid PRIMARY KEY,workspace_id uuid NOT NULL,created_by uuid NOT NULL REFERENCES users(id),client_request_id uuid NOT NULL,
 request_hash varchar(64) NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),command jsonb NOT NULL CHECK(octet_length(command::text)<=65536),
 payload jsonb NOT NULL CHECK(octet_length(payload::text)<=262144),parent_analysis_id uuid,planning_started_at timestamptz,
 UNIQUE(workspace_id,client_request_id),UNIQUE(workspace_id,analysis_id),
 FOREIGN KEY(workspace_id,analysis_id) REFERENCES analyses(workspace_id,id),
 FOREIGN KEY(workspace_id,parent_analysis_id) REFERENCES analysis_problems(workspace_id,analysis_id)
);
CREATE TABLE problem_executions (
 id uuid PRIMARY KEY,workspace_id uuid NOT NULL,analysis_id uuid NOT NULL,requested_by uuid NOT NULL REFERENCES users(id),
 status varchar(12) NOT NULL CHECK(status IN ('QUEUED','RUNNING','SUCCEEDED','FAILED')),
 payload jsonb NOT NULL CHECK(octet_length(payload::text)<=2097152),saved_runtime jsonb,created_at timestamptz NOT NULL DEFAULT now(),started_at timestamptz,
 UNIQUE(workspace_id,analysis_id,id),FOREIGN KEY(workspace_id,analysis_id) REFERENCES analysis_problems(workspace_id,analysis_id)
);
CREATE UNIQUE INDEX one_active_problem_execution ON problem_executions(analysis_id) WHERE status IN ('QUEUED','RUNNING');
CREATE TABLE problem_artifacts (
 id uuid PRIMARY KEY,workspace_id uuid NOT NULL,analysis_id uuid NOT NULL,execution_id uuid NOT NULL,
 name varchar(100) NOT NULL,media_type varchar(32) NOT NULL,sha256 varchar(64) NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
 content bytea NOT NULL CHECK(octet_length(content)<=8388608),UNIQUE(execution_id,name),
 FOREIGN KEY(workspace_id,analysis_id,execution_id) REFERENCES problem_executions(workspace_id,analysis_id,id)
);
CREATE FUNCTION protect_problem_intent() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Problem input is immutable'; END IF;
 IF NEW.command IS DISTINCT FROM OLD.command OR NEW.request_hash IS DISTINCT FROM OLD.request_hash OR
    NEW.workspace_id<>OLD.workspace_id OR NEW.analysis_id<>OLD.analysis_id OR NEW.created_by<>OLD.created_by OR
    NEW.client_request_id<>OLD.client_request_id OR NEW.parent_analysis_id IS DISTINCT FROM OLD.parent_analysis_id OR
    (NEW.payload - ARRAY['status','plan','audit','missing']) IS DISTINCT FROM (OLD.payload - ARRAY['status','plan','audit','missing']) OR
    (OLD.payload->'plan'<>'null'::jsonb AND NEW.payload->'plan' IS DISTINCT FROM OLD.payload->'plan') OR
    (OLD.payload->'audit'<>'null'::jsonb AND NEW.payload->'audit' IS DISTINCT FROM OLD.payload->'audit')
 THEN RAISE EXCEPTION 'Problem input/plan is immutable'; END IF;RETURN NEW;END $$;
CREATE TRIGGER immutable_problem_intent BEFORE UPDATE OR DELETE ON analysis_problems FOR EACH ROW EXECUTE FUNCTION protect_problem_intent();
CREATE FUNCTION protect_problem_execution() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' OR OLD.status IN ('SUCCEEDED','FAILED') THEN RAISE EXCEPTION 'Problem execution is immutable'; END IF;
 IF NEW.workspace_id<>OLD.workspace_id OR NEW.analysis_id<>OLD.analysis_id OR NEW.id<>OLD.id OR NEW.requested_by<>OLD.requested_by OR
 NEW.saved_runtime IS DISTINCT FROM OLD.saved_runtime OR (NEW.payload - ARRAY['status','failureCode','completedAt','imageId','runtimeVersion','result','verification','computationStatus']) IS DISTINCT FROM (OLD.payload - ARRAY['status','failureCode','completedAt','imageId','runtimeVersion','result','verification','computationStatus'])
 THEN RAISE EXCEPTION 'Frozen problem execution changed'; END IF;RETURN NEW;END $$;
CREATE TRIGGER immutable_problem_execution BEFORE UPDATE OR DELETE ON problem_executions FOR EACH ROW EXECUTE FUNCTION protect_problem_execution();

CREATE TRIGGER immutable_problem_artifact BEFORE UPDATE OR DELETE ON problem_artifacts FOR EACH ROW EXECUTE FUNCTION preserve_ai_authoring_event();
