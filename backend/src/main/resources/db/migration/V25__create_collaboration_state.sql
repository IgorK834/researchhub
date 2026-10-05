-- Binary CRDT state and its editor projection are committed in the same Spring transaction.
-- Activation is permanent: old revision PATCH/restore cannot overwrite CRDT history.
CREATE TABLE collaboration_documents (
    document_id uuid PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,
    sequence bigint NOT NULL DEFAULT 0 CHECK (sequence >= 0),
    state bytea CHECK (octet_length(state) BETWEEN 1 AND 4000000)
);
CREATE TABLE collaboration_credentials (
    token_hash varchar(64) PRIMARY KEY,
    workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at timestamptz NOT NULL
);
CREATE INDEX ix_collaboration_credentials_expiry ON collaboration_credentials(expires_at);
