-- Immutable, bounded document contexts. No browser-submitted document snapshots or model secrets.
CREATE TABLE canvas_contexts (
    id uuid PRIMARY KEY,
    workspace_id uuid NOT NULL REFERENCES workspaces(id),
    document_id uuid NOT NULL,
    created_by uuid NOT NULL REFERENCES users(id),
    client_request_id uuid NOT NULL,
    request_hash varchar(64) NOT NULL,
    request jsonb NOT NULL,
    context jsonb NOT NULL,
    created_at timestamptz NOT NULL,
    CONSTRAINT fk_canvas_document FOREIGN KEY(workspace_id,document_id) REFERENCES documents(workspace_id,id),
    CONSTRAINT uq_canvas_request UNIQUE(workspace_id,document_id,created_by,client_request_id),
    CONSTRAINT ck_canvas_context_size CHECK(octet_length(context::text)<=32768)
);
CREATE INDEX ix_canvas_context_document ON canvas_contexts(workspace_id,document_id,created_at);
