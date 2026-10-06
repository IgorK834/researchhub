CREATE TABLE product_audit_events (
    id uuid PRIMARY KEY,
    workspace_id uuid NOT NULL REFERENCES workspaces(id),
    actor_user_id uuid REFERENCES users(id),
    event_type varchar(40) NOT NULL CHECK (event_type IN ('WORKSPACE_CREATED','MEMBER_ADDED','MEMBER_ROLE_CHANGED','MEMBER_REMOVED',
        'SOURCE_UPLOADED','SOURCE_REPROCESSED','DOCUMENT_CREATED','AI_EVIDENCE_REQUESTED','AI_SUGGESTION_ACCEPTED','ANALYSIS_EXECUTED','ANALYSIS_BLOCK_INSERTED')),
    resource_type varchar(40) NOT NULL CHECK (resource_type IN ('WORKSPACE','MEMBER','SOURCE','DOCUMENT','AI_SUGGESTION','COMMENT_AI_SUGGESTION','ANALYSIS_EXECUTION')),
    resource_id uuid NOT NULL,
    metadata jsonb NOT NULL CHECK (jsonb_typeof(metadata) = 'object' AND octet_length(metadata::text) <= 2048),
    created_at timestamptz NOT NULL
);
CREATE INDEX ix_product_audit_workspace_time ON product_audit_events(workspace_id,created_at DESC,id DESC);
CREATE TRIGGER product_audit_immutable BEFORE UPDATE OR DELETE ON product_audit_events
    FOR EACH ROW EXECUTE FUNCTION review_history_is_immutable();

-- AI is a contribution kind, never a user account or a human reply.
CREATE TABLE comment_ai_suggestions (
    id uuid PRIMARY KEY,
    workspace_id uuid NOT NULL,
    document_id uuid NOT NULL,
    comment_id uuid NOT NULL,
    requested_by uuid NOT NULL REFERENCES users(id),
    payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object' AND octet_length(payload::text) <= 262144),
    created_at timestamptz NOT NULL,
    UNIQUE(workspace_id,document_id,comment_id,id),
    FOREIGN KEY(workspace_id,document_id,comment_id) REFERENCES document_comments(workspace_id,document_id,id)
);
CREATE INDEX ix_comment_ai_document ON comment_ai_suggestions(workspace_id,document_id,created_at,id);
CREATE TRIGGER comment_ai_immutable BEFORE UPDATE OR DELETE ON comment_ai_suggestions
    FOR EACH ROW EXECUTE FUNCTION review_history_is_immutable();

-- One immutable receipt per manually inserted candidate, confirmed against saved document provenance.
CREATE TABLE comment_ai_citation_acceptances (
    suggestion_id uuid NOT NULL REFERENCES comment_ai_suggestions(id),
    chunk_id varchar(64) NOT NULL CHECK (chunk_id ~ '^[a-f0-9]{64}$'),
    actor_user_id uuid NOT NULL REFERENCES users(id),
    document_revision bigint NOT NULL CHECK (document_revision > 0),
    created_at timestamptz NOT NULL,
    PRIMARY KEY(suggestion_id,chunk_id)
);
CREATE TRIGGER comment_ai_acceptance_immutable BEFORE UPDATE OR DELETE ON comment_ai_citation_acceptances
    FOR EACH ROW EXECUTE FUNCTION review_history_is_immutable();
