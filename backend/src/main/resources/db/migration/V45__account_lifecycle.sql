ALTER TABLE users ADD COLUMN email_verified_at timestamptz;
CREATE TABLE workspace_invitation (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES workspaces(id),
 email_normalized varchar(320) NOT NULL, role varchar(32) NOT NULL CHECK (role IN ('OWNER','EDITOR','VIEWER')),
 token_hash varchar(64) NOT NULL UNIQUE CHECK (token_hash ~ '^[a-f0-9]{64}$'),
 invited_by uuid NOT NULL REFERENCES users(id), expires_at timestamptz NOT NULL,
 accepted_at timestamptz, revoked_at timestamptz, created_at timestamptz NOT NULL,
 CHECK (expires_at > created_at), CHECK (accepted_at IS NULL OR revoked_at IS NULL)
);
CREATE INDEX ix_workspace_invitation_workspace ON workspace_invitation(workspace_id, created_at DESC);
CREATE TABLE account_lifecycle_token (
 id uuid PRIMARY KEY, email_normalized varchar(320) NOT NULL,
 purpose varchar(16) NOT NULL CHECK (purpose IN ('RESET','VERIFY')),
 token_hash varchar(64) NOT NULL UNIQUE CHECK (token_hash ~ '^[a-f0-9]{64}$'),
 expires_at timestamptz NOT NULL, used_at timestamptz, created_at timestamptz NOT NULL,
 CHECK (expires_at > created_at)
);
CREATE INDEX ix_account_token_email ON account_lifecycle_token(email_normalized, purpose);
CREATE TABLE account_audit_events (
 id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id),
 event_type varchar(40) NOT NULL CHECK (event_type IN ('PASSWORD_CHANGED','SESSION_REVOKED','SESSIONS_REVOKED','SESSIONS_VIEWED','PASSWORD_RESET','EMAIL_VERIFIED')),
 created_at timestamptz NOT NULL
);
CREATE TRIGGER account_audit_immutable BEFORE UPDATE OR DELETE ON account_audit_events
 FOR EACH ROW EXECUTE FUNCTION review_history_is_immutable();
CREATE TABLE security_operation_bucket (
 subject_hash varchar(64) NOT NULL, operation varchar(32) NOT NULL,
 window_start bigint NOT NULL, request_count integer NOT NULL CHECK (request_count > 0),
 PRIMARY KEY (subject_hash,operation)
);
ALTER TABLE product_audit_events DROP CONSTRAINT product_audit_events_event_type_check;
ALTER TABLE product_audit_events ADD CONSTRAINT product_audit_events_event_type_check CHECK (event_type IN (
 'WORKSPACE_CREATED','MEMBER_ADDED','MEMBER_ROLE_CHANGED','MEMBER_REMOVED','SOURCE_UPLOADED','SOURCE_REPROCESSED',
 'DOCUMENT_CREATED','AI_EVIDENCE_REQUESTED','AI_SUGGESTION_ACCEPTED','ANALYSIS_EXECUTED','ANALYSIS_BLOCK_INSERTED',
 'CANVAS_STAGE_COMPLETED','INVITATION_CREATED','INVITATION_ACCEPTED','INVITATION_REVOKED'));
ALTER TABLE product_audit_events DROP CONSTRAINT product_audit_events_resource_type_check;
ALTER TABLE product_audit_events ADD CONSTRAINT product_audit_events_resource_type_check CHECK (resource_type IN (
 'WORKSPACE','MEMBER','SOURCE','DOCUMENT','AI_SUGGESTION','COMMENT_AI_SUGGESTION','ANALYSIS_EXECUTION','INVITATION'));
