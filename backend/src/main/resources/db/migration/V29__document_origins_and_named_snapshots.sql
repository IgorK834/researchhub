CREATE TABLE document_content_operations (
    id uuid PRIMARY KEY,
    sequence bigint GENERATED ALWAYS AS IDENTITY,
    workspace_id uuid NOT NULL,
    document_id uuid NOT NULL,
    block_id uuid NOT NULL,
    category varchar(24) NOT NULL CHECK (category IN ('HUMAN','AI_GENERATED','AI_REWRITTEN','IMPORTED','ANALYSIS_DERIVED')),
    actor_user_id uuid REFERENCES users(id),
    actor_name varchar(200) NOT NULL,
    operation_type varchar(32) NOT NULL,
    source_operation_id uuid,
    metadata jsonb NOT NULL CHECK (jsonb_typeof(metadata)='object' AND octet_length(metadata::text)<=262144),
    content_sha256 varchar(64) NOT NULL CHECK (content_sha256 ~ '^[a-f0-9]{64}$'),
    document_revision bigint NOT NULL CHECK (document_revision>0),
    created_at timestamptz NOT NULL,
    FOREIGN KEY(workspace_id,document_id) REFERENCES documents(workspace_id,id)
);
CREATE INDEX ix_document_operations_block ON document_content_operations(workspace_id,document_id,block_id,document_revision DESC,sequence DESC);
CREATE TRIGGER document_operations_immutable BEFORE UPDATE OR DELETE ON document_content_operations
    FOR EACH ROW EXECUTE FUNCTION review_history_is_immutable();

ALTER TABLE document_versions
    DROP CONSTRAINT uq_document_versions_document_revision,
    DROP CONSTRAINT ck_document_versions_reason,
    ALTER COLUMN created_by DROP NOT NULL,
    ADD COLUMN name varchar(120),
    ADD COLUMN actor_name varchar(200),
    ADD COLUMN yjs_state bytea,
    ADD COLUMN state_sha256 varchar(64),
    ADD COLUMN collaboration_epoch bigint,
    ADD COLUMN collaboration_sequence bigint,
    ADD CONSTRAINT ck_document_snapshot_name CHECK (name IS NULL OR length(trim(name)) BETWEEN 1 AND 120),
    ADD CONSTRAINT ck_document_snapshot_actor CHECK (created_by IS NOT NULL OR reason='SCHEDULED_SNAPSHOT'),
    ADD CONSTRAINT ck_document_versions_reason CHECK (reason IN ('CREATED','MANUAL_SAVE','AUTOSAVE_CHECKPOINT','RESTORE','AI_ACCEPTANCE','MANUAL_SNAPSHOT','SCHEDULED_SNAPSHOT')),
    ADD CONSTRAINT ck_document_snapshot_state CHECK ((yjs_state IS NULL AND state_sha256 IS NULL AND collaboration_epoch IS NULL AND collaboration_sequence IS NULL)
        OR (yjs_state IS NOT NULL AND state_sha256 IS NOT NULL AND collaboration_epoch IS NOT NULL AND collaboration_sequence IS NOT NULL AND octet_length(yjs_state) BETWEEN 1 AND 4000000 AND state_sha256 ~ '^[a-f0-9]{64}$' AND collaboration_epoch>=0 AND collaboration_sequence>0));
CREATE INDEX ix_document_versions_order ON document_versions(document_id,revision DESC,created_at DESC,id DESC);
ALTER TABLE collaboration_documents ADD COLUMN epoch bigint NOT NULL DEFAULT 0 CHECK(epoch>=0);
ALTER TABLE collaboration_credentials ADD COLUMN epoch bigint NOT NULL DEFAULT 0 CHECK(epoch>=0);
