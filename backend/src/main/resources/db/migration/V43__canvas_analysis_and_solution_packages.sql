-- Resume saved execution observation without repeating planning or enqueue after a process restart.
ALTER TABLE canvas_turns DROP CONSTRAINT canvas_turns_status_check;
ALTER TABLE canvas_turns ADD CHECK(status IN ('ACCEPTED','PLANNING','EXECUTING','WAITING_FOR_INPUT','PROPOSAL_READY','COMPLETED','FAILED','CANCELLED'));
ALTER TABLE canvas_turns DROP CONSTRAINT canvas_turns_result_kind_check;
ALTER TABLE canvas_turns ADD CHECK(result_kind IN ('ANSWER','CLARIFICATION','EDIT_PROPOSAL','ANALYSIS_HANDOFF','PROBLEM_HANDOFF','ANALYSIS_RESULT'));
CREATE INDEX ix_canvas_executing ON canvas_turns(started_at,id) WHERE status='EXECUTING';
-- Calculation packages may originate in Studio or an explicit saved-output picker.
ALTER TABLE canvas_proposals ALTER COLUMN turn_id DROP NOT NULL;
ALTER TABLE canvas_proposals DROP CONSTRAINT canvas_proposals_turn_id_key;
CREATE UNIQUE INDEX uq_canvas_edit_turn ON canvas_proposals(turn_id) WHERE NOT (payload ? 'calculation');
CREATE OR REPLACE FUNCTION protect_problem_execution() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' OR OLD.status IN ('SUCCEEDED','FAILED') THEN RAISE EXCEPTION 'Problem execution is immutable'; END IF;
 IF NEW.workspace_id<>OLD.workspace_id OR NEW.analysis_id<>OLD.analysis_id OR NEW.id<>OLD.id OR NEW.requested_by<>OLD.requested_by OR
 NEW.saved_runtime IS DISTINCT FROM OLD.saved_runtime OR (NEW.payload - ARRAY['status','failureCode','completedAt','imageId','runtimeVersion','result','verification','computationStatus','solution']) IS DISTINCT FROM (OLD.payload - ARRAY['status','failureCode','completedAt','imageId','runtimeVersion','result','verification','computationStatus','solution'])
 THEN RAISE EXCEPTION 'Frozen problem execution changed'; END IF;RETURN NEW;END $$;
ALTER TABLE problem_executions ADD CHECK(payload->'solution' IS NULL OR payload->'solution'='null'::jsonb OR status='SUCCEEDED');
