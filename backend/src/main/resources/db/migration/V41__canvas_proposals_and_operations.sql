CREATE TABLE canvas_proposals (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL, document_id uuid NOT NULL,
 context_id uuid NOT NULL, turn_id uuid NOT NULL UNIQUE, supersedes uuid,
 state varchar(16) NOT NULL CHECK(state IN ('PENDING','ACCEPTED','REJECTED','SUPERSEDED')),
 payload jsonb NOT NULL CHECK(octet_length(payload::text)<=262144), operation_id uuid,
 UNIQUE(workspace_id,id),
 FOREIGN KEY(workspace_id,document_id) REFERENCES documents(workspace_id,id),
 FOREIGN KEY(workspace_id,context_id) REFERENCES canvas_contexts(workspace_id,id),
 FOREIGN KEY(turn_id) REFERENCES canvas_turns(id),
 FOREIGN KEY(workspace_id,supersedes) REFERENCES canvas_proposals(workspace_id,id)
);
CREATE TABLE canvas_operations (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL, document_id uuid NOT NULL, caller_id uuid NOT NULL REFERENCES users(id),
 proposal_id uuid NOT NULL, kind varchar(8) NOT NULL CHECK(kind IN ('ACCEPT','UNDO')),
 source_operation_id uuid, request_hash varchar(64) NOT NULL CHECK(request_hash ~ '^[0-9a-f]{64}$'),
 epoch bigint, patch jsonb CHECK(patch IS NULL OR octet_length(patch::text)<=262144), receipt jsonb, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(workspace_id,id),
 FOREIGN KEY(workspace_id,document_id) REFERENCES documents(workspace_id,id),
 FOREIGN KEY(workspace_id,proposal_id) REFERENCES canvas_proposals(workspace_id,id),
 FOREIGN KEY(workspace_id,source_operation_id) REFERENCES canvas_operations(workspace_id,id)
);
ALTER TABLE canvas_proposals ADD FOREIGN KEY(workspace_id,operation_id) REFERENCES canvas_operations(workspace_id,id);
ALTER TABLE canvas_turns ADD COLUMN canvas_proposal_id uuid;
ALTER TABLE canvas_turns ADD FOREIGN KEY(workspace_id,canvas_proposal_id) REFERENCES canvas_proposals(workspace_id,id);
ALTER TABLE canvas_turns ADD COLUMN model_started boolean NOT NULL DEFAULT false;
ALTER TABLE canvas_turns ADD COLUMN analysis_id uuid;
ALTER TABLE canvas_turns ADD FOREIGN KEY(workspace_id,analysis_id) REFERENCES analyses(workspace_id,id);
ALTER TABLE canvas_turns DROP CONSTRAINT canvas_turns_status_check;
ALTER TABLE canvas_turns ADD CHECK(status IN ('ACCEPTED','PLANNING','WAITING_FOR_INPUT','PROPOSAL_READY','COMPLETED','FAILED','CANCELLED'));
ALTER TABLE canvas_turns DROP CONSTRAINT canvas_turns_result_kind_check;
ALTER TABLE canvas_turns ADD CHECK(result_kind IN ('ANSWER','CLARIFICATION','EDIT_PROPOSAL','ANALYSIS_HANDOFF','PROBLEM_HANDOFF'));
CREATE INDEX ix_canvas_operations_document ON canvas_operations(workspace_id,document_id,created_at);
CREATE UNIQUE INDEX uq_canvas_compensation ON canvas_operations(source_operation_id) WHERE kind='UNDO' AND receipt IS NOT NULL;
CREATE FUNCTION preserve_canvas_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.receipt IS NOT NULL THEN RAISE EXCEPTION 'Canvas operation receipts are immutable'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER tg_canvas_receipt BEFORE UPDATE OR DELETE ON canvas_operations FOR EACH ROW EXECUTE FUNCTION preserve_canvas_receipt();
CREATE FUNCTION preserve_canvas_proposal_payload() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.payload IS DISTINCT FROM OLD.payload THEN RAISE EXCEPTION 'Canvas proposal versions are immutable'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER tg_canvas_proposal_payload BEFORE UPDATE ON canvas_proposals FOR EACH ROW EXECUTE FUNCTION preserve_canvas_proposal_payload();
ALTER TABLE ai_messages ADD COLUMN canvas_result jsonb;
ALTER TABLE ai_messages DROP CONSTRAINT ck_ai_messages_visible_complete;
ALTER TABLE ai_messages ADD CONSTRAINT ck_ai_messages_visible_complete CHECK (
 (role='USER' AND sequence % 2=1 AND char_length(content)<=8000 AND response IS NULL AND canvas_result IS NULL
  AND model IS NULL AND usage IS NULL AND template_id IS NULL AND template_hash IS NULL AND generation_id IS NULL
  AND citations='[]'::jsonb AND attempt_id IS NOT NULL AND started_at IS NOT NULL
  AND ((status='PENDING' AND completed_at IS NULL AND error_code IS NULL)
    OR (status='COMPLETED' AND completed_at IS NOT NULL AND error_code IS NULL)
    OR (status IN ('FAILED','ABANDONED') AND completed_at IS NOT NULL AND error_code IS NOT NULL)))
 OR (role='ASSISTANT' AND sequence % 2=0 AND status='COMPLETED' AND char_length(content)<=25000
  AND selected_source_ids IS NULL AND completed_at IS NOT NULL AND error_code IS NULL AND attempt_id IS NULL AND started_at IS NULL
  AND ((response IS NOT NULL AND canvas_result IS NULL AND response->>'answer' IS NOT NULL AND response->>'answer'=content)
    OR (response IS NULL AND canvas_result IS NOT NULL AND canvas_result->>'text' IS NOT NULL AND canvas_result->>'text'=content))));
