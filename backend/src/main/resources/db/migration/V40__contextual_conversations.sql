-- Reuse the workspace history. A durable queue contains operations, never another copy of chats.
ALTER TABLE canvas_contexts ADD CONSTRAINT uq_canvas_context_workspace UNIQUE(workspace_id,id);
ALTER TABLE ai_messages ADD CONSTRAINT uq_ai_messages_workspace UNIQUE(workspace_id,id);
ALTER TABLE ai_messages ADD CONSTRAINT uq_ai_messages_conversation UNIQUE(workspace_id,conversation_id,id);
ALTER TABLE ai_conversations ADD COLUMN origin jsonb;
ALTER TABLE ai_conversations ADD COLUMN origin_document_id uuid;
ALTER TABLE ai_conversations ADD COLUMN origin_context_id uuid;
ALTER TABLE ai_conversations ADD CONSTRAINT fk_conversation_document FOREIGN KEY(workspace_id,origin_document_id) REFERENCES documents(workspace_id,id);
ALTER TABLE ai_conversations ADD CONSTRAINT fk_conversation_context FOREIGN KEY(workspace_id,origin_context_id) REFERENCES canvas_contexts(workspace_id,id);
ALTER TABLE ai_conversations ADD COLUMN client_conversation_id uuid;
ALTER TABLE ai_conversations ADD COLUMN first_request_hash varchar(64);
CREATE UNIQUE INDEX uq_contextual_conversation_request ON ai_conversations(workspace_id,created_by,client_conversation_id) WHERE client_conversation_id IS NOT NULL;
ALTER TABLE ai_conversations ADD CONSTRAINT ck_contextual_origin CHECK (
  (client_conversation_id IS NULL AND first_request_hash IS NULL AND origin IS NULL AND origin_document_id IS NULL AND origin_context_id IS NULL) OR
  (client_conversation_id IS NOT NULL AND first_request_hash ~ '^[0-9a-f]{64}$' AND jsonb_typeof(origin)='object' AND origin_document_id IS NOT NULL AND origin_context_id IS NOT NULL));
-- Canvas instructions permit 8000 UTF-16 units; legacy /messages validation stays at 2000.
ALTER TABLE ai_messages DROP CONSTRAINT ck_ai_messages_visible_complete;
ALTER TABLE ai_messages ADD CONSTRAINT ck_ai_messages_visible_complete CHECK (
    (role='USER' AND sequence % 2 = 1 AND char_length(content) <= 8000
      AND response IS NULL AND model IS NULL AND usage IS NULL AND template_id IS NULL AND template_hash IS NULL
      AND generation_id IS NULL AND citations='[]'::jsonb AND attempt_id IS NOT NULL AND started_at IS NOT NULL
      AND ((status='PENDING' AND completed_at IS NULL AND error_code IS NULL)
        OR (status='COMPLETED' AND completed_at IS NOT NULL AND error_code IS NULL)
        OR (status IN ('FAILED','ABANDONED') AND completed_at IS NOT NULL AND error_code IS NOT NULL)))
    OR (role='ASSISTANT' AND sequence % 2 = 0 AND status='COMPLETED' AND char_length(content) <= 25000
      AND response IS NOT NULL AND response->>'answer' IS NOT NULL AND response->>'answer'=content AND selected_source_ids IS NULL
      AND completed_at IS NOT NULL AND error_code IS NULL AND attempt_id IS NULL AND started_at IS NULL));
ALTER TABLE analysis_executions ADD CONSTRAINT uq_canvas_execution_workspace UNIQUE(workspace_id,id);
CREATE TABLE canvas_turns (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  conversation_id uuid NOT NULL,
  document_id uuid NOT NULL,
  context_id uuid NOT NULL,
  caller_id uuid NOT NULL REFERENCES users(id),
  client_request_id uuid NOT NULL,
  request_hash varchar(64) NOT NULL CHECK(request_hash ~ '^[0-9a-f]{64}$'),
  request jsonb NOT NULL CHECK(octet_length(request::text)<=65536),
  status varchar(32) NOT NULL CHECK(status IN ('ACCEPTED','PLANNING','WAITING_FOR_INPUT','COMPLETED','FAILED','CANCELLED')),
  user_message_id uuid NOT NULL,
  message_id uuid,
  proposal_id uuid,
  execution_id uuid,
  result_kind varchar(32) CHECK(result_kind IN ('ANSWER','CLARIFICATION')),
  memory_summary jsonb,
  failure_code varchar(32),
  lease_id uuid,
  started_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  FOREIGN KEY(conversation_id,workspace_id) REFERENCES ai_conversations(id,workspace_id) ON DELETE CASCADE,
  FOREIGN KEY(workspace_id,document_id) REFERENCES documents(workspace_id,id),
  FOREIGN KEY(workspace_id,context_id) REFERENCES canvas_contexts(workspace_id,id),
  FOREIGN KEY(workspace_id,conversation_id,user_message_id) REFERENCES ai_messages(workspace_id,conversation_id,id),
  FOREIGN KEY(workspace_id,conversation_id,message_id) REFERENCES ai_messages(workspace_id,conversation_id,id),
  FOREIGN KEY(workspace_id,proposal_id) REFERENCES ai_authoring_suggestions(workspace_id,id),
  FOREIGN KEY(workspace_id,execution_id) REFERENCES analysis_executions(workspace_id,id),
  UNIQUE(workspace_id,conversation_id,client_request_id)
);
CREATE INDEX ix_canvas_pending ON canvas_turns(created_at,id) WHERE status IN ('ACCEPTED','PLANNING');
CREATE INDEX ix_canvas_history ON canvas_turns(workspace_id,conversation_id,created_at DESC);
