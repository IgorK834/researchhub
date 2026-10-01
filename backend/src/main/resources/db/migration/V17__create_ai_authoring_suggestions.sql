-- Approval state and immutable AI-origin events share the document transaction.
ALTER TABLE documents ADD CONSTRAINT uq_documents_workspace UNIQUE (workspace_id, id);
CREATE TABLE ai_authoring_suggestions (
    id uuid PRIMARY KEY,
    workspace_id uuid NOT NULL,
    document_id uuid NOT NULL,
    created_by uuid NOT NULL REFERENCES users(id),
    state varchar(16) NOT NULL CHECK (state IN ('PENDING','ACCEPTED','REJECTED')),
    payload jsonb NOT NULL CHECK (jsonb_typeof(payload)='object' AND octet_length(payload::text)<=262144),
    created_at timestamptz NOT NULL,
    accepted_revision bigint,
    FOREIGN KEY (workspace_id,document_id) REFERENCES documents(workspace_id,id),
    UNIQUE (workspace_id,id),
    CHECK ((state='ACCEPTED') = (accepted_revision IS NOT NULL))
);
CREATE INDEX ix_authoring_document ON ai_authoring_suggestions(workspace_id,document_id,created_at DESC);
CREATE TABLE ai_authoring_events (
    id uuid PRIMARY KEY,
    workspace_id uuid NOT NULL,
    document_id uuid NOT NULL,
    accepted_by uuid NOT NULL REFERENCES users(id),
    revision bigint NOT NULL CHECK (revision > 1),
    acceptance jsonb NOT NULL CHECK (jsonb_typeof(acceptance)='object'),
    content_hash varchar(64) NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
    created_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (workspace_id,id) REFERENCES ai_authoring_suggestions(workspace_id,id),
    FOREIGN KEY (workspace_id,document_id) REFERENCES documents(workspace_id,id),
    UNIQUE(document_id,revision)
);
CREATE FUNCTION preserve_ai_authoring_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'AI authoring events are immutable'; END; $$;
CREATE TRIGGER tg_ai_authoring_events_immutable BEFORE UPDATE OR DELETE ON ai_authoring_events
    FOR EACH ROW EXECUTE FUNCTION preserve_ai_authoring_event();

ALTER TABLE document_versions DROP CONSTRAINT ck_document_versions_reason;
ALTER TABLE document_versions ADD CONSTRAINT ck_document_versions_reason
    CHECK (reason IN ('CREATED','MANUAL_SAVE','AUTOSAVE_CHECKPOINT','RESTORE','AI_ACCEPTANCE'));
