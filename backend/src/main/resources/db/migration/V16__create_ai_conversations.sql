-- Product-visible research history; never store raw provider bodies or hidden reasoning.
CREATE TABLE ai_conversations (
    id uuid PRIMARY KEY,
    workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    created_by uuid REFERENCES users(id) ON DELETE SET NULL,
    title varchar(160) NOT NULL CHECK (length(btrim(title)) > 0),
    next_sequence bigint NOT NULL DEFAULT 1 CHECK (next_sequence > 0 AND next_sequence % 2 = 1),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(id, workspace_id)
);
CREATE INDEX ix_ai_conversations_workspace_recent ON ai_conversations(workspace_id, updated_at DESC, id DESC);

CREATE TABLE ai_messages (
    id uuid PRIMARY KEY,
    workspace_id uuid NOT NULL,
    conversation_id uuid NOT NULL,
    client_request_id uuid NOT NULL,
    sequence bigint NOT NULL CHECK (sequence > 0),
    role varchar(16) NOT NULL CHECK (role IN ('USER','ASSISTANT')),
    status varchar(16) NOT NULL CHECK (status IN ('PENDING','COMPLETED','FAILED','ABANDONED')),
    author_id uuid REFERENCES users(id) ON DELETE SET NULL,
    content text NOT NULL CHECK (length(btrim(content)) > 0),
    selected_source_ids jsonb CHECK (jsonb_typeof(selected_source_ids) = 'array' AND jsonb_array_length(selected_source_ids) <= 100),
    citations jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(citations) = 'array' AND jsonb_array_length(citations) <= 12 AND octet_length(citations::text) <= 262144),
    model jsonb CHECK (jsonb_typeof(model) = 'object' AND octet_length(model::text) <= 2048),
    usage jsonb CHECK (jsonb_typeof(usage) = 'object' AND octet_length(usage::text) <= 1024),
    template_id varchar(128),
    template_hash varchar(64) CHECK (template_hash ~ '^[0-9a-f]{64}$'),
    generation_id uuid REFERENCES ai_generation_runs(request_id) ON DELETE SET NULL,
    response jsonb CHECK (jsonb_typeof(response) = 'object' AND octet_length(response::text) <= 524288),
    attempt_id uuid,
    started_at timestamptz,
    error_code varchar(32) CHECK (error_code IN ('AI_UNAVAILABLE','AI_PROVIDER_ERROR','AI_OUTPUT_INVALID','AI_REFUSED','AI_CONTEXT_TOO_LARGE','VALIDATION_FAILED','FORBIDDEN','RESOURCE_NOT_FOUND','CONFLICT','INTERNAL_ERROR')),
    created_at timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz,
    FOREIGN KEY(conversation_id,workspace_id) REFERENCES ai_conversations(id,workspace_id) ON DELETE CASCADE,
    UNIQUE(conversation_id,client_request_id,role),
    UNIQUE(conversation_id,sequence),
    CONSTRAINT ck_ai_messages_visible_complete CHECK (
        (role='USER' AND sequence % 2 = 1 AND char_length(content) <= 2000
            AND response IS NULL AND model IS NULL AND usage IS NULL AND template_id IS NULL AND template_hash IS NULL
            AND generation_id IS NULL AND citations='[]'::jsonb AND attempt_id IS NOT NULL AND started_at IS NOT NULL
            AND ((status='PENDING' AND completed_at IS NULL AND error_code IS NULL)
              OR (status='COMPLETED' AND completed_at IS NOT NULL AND error_code IS NULL)
              OR (status IN ('FAILED','ABANDONED') AND completed_at IS NOT NULL AND error_code IS NOT NULL)))
        OR (role='ASSISTANT' AND sequence % 2 = 0 AND status='COMPLETED' AND char_length(content) <= 25000
            AND response IS NOT NULL AND response->>'answer' IS NOT NULL AND response->>'answer'=content AND selected_source_ids IS NULL
            AND completed_at IS NOT NULL AND error_code IS NULL AND attempt_id IS NULL AND started_at IS NULL))
);
CREATE INDEX ix_ai_messages_history ON ai_messages(workspace_id,conversation_id,sequence);
