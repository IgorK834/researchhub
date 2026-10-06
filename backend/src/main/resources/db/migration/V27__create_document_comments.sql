-- Review/v1. Structured anchors live in editor JSON/Yjs; comments never depend on mutable text offsets.
ALTER TABLE documents ADD CONSTRAINT uq_documents_workspace_id UNIQUE (workspace_id, id);

CREATE TABLE document_comments (
    id uuid PRIMARY KEY,
    workspace_id uuid NOT NULL,
    document_id uuid NOT NULL,
    author_id uuid NOT NULL REFERENCES users(id),
    author_name varchar(120) NOT NULL,
    body varchar(4000) NOT NULL CHECK (length(btrim(body)) > 0),
    status varchar(16) NOT NULL CHECK (status IN ('OPEN', 'RESOLVED')),
    anchor_strategy varchar(32) NOT NULL DEFAULT 'TEXT_MARK_V1' CHECK (anchor_strategy = 'TEXT_MARK_V1'),
    anchor_id uuid NOT NULL,
    anchor_quote varchar(2000) NOT NULL CHECK (length(btrim(anchor_quote)) > 0),
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    resolved_by uuid REFERENCES users(id),
    resolved_at timestamptz,
    FOREIGN KEY (workspace_id, document_id) REFERENCES documents(workspace_id, id),
    UNIQUE (workspace_id, document_id, id),
    UNIQUE (document_id, anchor_id),
    CHECK ((status = 'RESOLVED' AND resolved_by IS NOT NULL AND resolved_at IS NOT NULL)
        OR (status = 'OPEN' AND resolved_by IS NULL AND resolved_at IS NULL))
);
CREATE INDEX ix_document_comments_document ON document_comments(workspace_id, document_id, created_at, id);

CREATE TABLE comment_replies (
    id uuid PRIMARY KEY,
    workspace_id uuid NOT NULL,
    document_id uuid NOT NULL,
    comment_id uuid NOT NULL,
    author_id uuid NOT NULL REFERENCES users(id),
    author_name varchar(120) NOT NULL,
    body varchar(4000) NOT NULL CHECK (length(btrim(body)) > 0),
    created_at timestamptz NOT NULL,
    FOREIGN KEY (workspace_id, document_id, comment_id) REFERENCES document_comments(workspace_id, document_id, id),
    UNIQUE (workspace_id, document_id, comment_id, id)
);
CREATE INDEX ix_comment_replies_thread ON comment_replies(workspace_id, document_id, comment_id, created_at, id);

CREATE TABLE comment_audit_events (
    id uuid PRIMARY KEY,
    workspace_id uuid NOT NULL,
    document_id uuid NOT NULL,
    comment_id uuid NOT NULL,
    reply_id uuid,
    actor_id uuid NOT NULL REFERENCES users(id),
    actor_name varchar(120) NOT NULL,
    action varchar(16) NOT NULL CHECK (action IN ('CREATED', 'REPLIED', 'RESOLVED', 'REOPENED')),
    previous_status varchar(16) CHECK (previous_status IN ('OPEN', 'RESOLVED')),
    status varchar(16) NOT NULL CHECK (status IN ('OPEN', 'RESOLVED')),
    created_at timestamptz NOT NULL,
    FOREIGN KEY (workspace_id, document_id, comment_id) REFERENCES document_comments(workspace_id, document_id, id),
    FOREIGN KEY (workspace_id, document_id, comment_id, reply_id) REFERENCES comment_replies(workspace_id, document_id, comment_id, id),
    CHECK ((action = 'REPLIED') = (reply_id IS NOT NULL))
);
CREATE INDEX ix_comment_audit_thread ON comment_audit_events(workspace_id, document_id, comment_id, created_at, id);

CREATE FUNCTION review_history_is_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'Review history is immutable' USING ERRCODE = 'restrict_violation';
END;
$$;
CREATE TRIGGER tg_comment_replies_immutable BEFORE UPDATE OR DELETE ON comment_replies
    FOR EACH ROW EXECUTE FUNCTION review_history_is_immutable();
CREATE TRIGGER tg_comment_audit_immutable BEFORE UPDATE OR DELETE ON comment_audit_events
    FOR EACH ROW EXECUTE FUNCTION review_history_is_immutable();

COMMENT ON TABLE document_comments IS 'Workspace-scoped review threads. Quote and author name retain creation context; missing marks orphan a thread.';
COMMENT ON TABLE comment_audit_events IS 'Append-only contribution history, committed atomically with comment changes.';
