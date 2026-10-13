-- File-only bibliography migration. Imported records are metadata, never source bytes or RAG evidence.
ALTER TABLE cost_quota_bucket DROP CONSTRAINT cost_quota_bucket_category_check;
ALTER TABLE cost_quota_bucket ALTER COLUMN category TYPE varchar(32);
ALTER TABLE cost_quota_bucket ADD CONSTRAINT cost_quota_bucket_category_check
    CHECK(category IN ('LLM','ANALYSIS','RETRIEVAL','METADATA_LOOKUP','BIBLIOGRAPHY_IMPORT'));
ALTER TABLE sources ADD CONSTRAINT uq_sources_workspace_id UNIQUE(workspace_id,id);
CREATE TABLE bibliography_imports (
    id uuid PRIMARY KEY,
    workspace_id uuid NOT NULL REFERENCES workspaces(id),
    created_by uuid NOT NULL REFERENCES users(id),
    file_name varchar(255) NOT NULL CHECK(length(btrim(file_name)) > 0),
    file_sha256 varchar(64) NOT NULL CHECK(file_sha256 ~ '^[a-f0-9]{64}$'),
    format varchar(16) NOT NULL CHECK(format IN ('BIBTEX','RIS','CSL_JSON')),
    origin varchar(16) NOT NULL CHECK(origin IN ('GENERIC','ZOTERO','MENDELEY')),
    status varchar(16) NOT NULL CHECK(status IN ('PREVIEWED','CONFIRMED','CANCELLED')),
    record_count integer NOT NULL CHECK(record_count BETWEEN 0 AND 1000),
    preview jsonb NOT NULL CHECK(jsonb_typeof(preview)='object' AND octet_length(preview::text) <= 16777216),
    confirmation_sha256 varchar(64) CHECK(confirmation_sha256 ~ '^[a-f0-9]{64}$'),
    result jsonb CHECK(jsonb_typeof(result)='object' AND octet_length(result::text) <= 1048576),
    created_at timestamptz NOT NULL,
    confirmed_at timestamptz,
    cancelled_at timestamptz,
    UNIQUE(workspace_id,id),
    CHECK ((status='CONFIRMED')=(confirmation_sha256 IS NOT NULL AND result IS NOT NULL AND confirmed_at IS NOT NULL)),
    CHECK ((status='CANCELLED')=(cancelled_at IS NOT NULL))
);
CREATE UNIQUE INDEX uq_bibliography_import_active_file
    ON bibliography_imports(workspace_id,file_sha256) WHERE status IN ('PREVIEWED','CONFIRMED');
CREATE INDEX ix_bibliography_import_workspace ON bibliography_imports(workspace_id,created_at DESC,id DESC);

CREATE FUNCTION preserve_bibliography_import() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
       OR NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.created_at IS DISTINCT FROM OLD.created_at
       OR NEW.file_name IS DISTINCT FROM OLD.file_name OR NEW.file_sha256 IS DISTINCT FROM OLD.file_sha256
       OR NEW.format IS DISTINCT FROM OLD.format OR NEW.origin IS DISTINCT FROM OLD.origin
       OR NEW.record_count IS DISTINCT FROM OLD.record_count OR NEW.preview IS DISTINCT FROM OLD.preview
       OR OLD.status<>'PREVIEWED' OR NEW.status NOT IN ('CONFIRMED','CANCELLED') THEN
        RAISE EXCEPTION 'bibliography preview and terminal confirmation are immutable' USING ERRCODE='restrict_violation';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER tg_preserve_bibliography_import BEFORE UPDATE ON bibliography_imports
    FOR EACH ROW EXECUTE FUNCTION preserve_bibliography_import();

CREATE TABLE bibliography_items (
    id uuid PRIMARY KEY,
    workspace_id uuid NOT NULL REFERENCES workspaces(id),
    source_id uuid,
    item_type varchar(32) NOT NULL CHECK(item_type IN ('article-journal','article','book','chapter','paper-conference','thesis','report','webpage','document','dataset')),
    bibliography jsonb NOT NULL,
    tags jsonb NOT NULL DEFAULT '[]',
    collections jsonb NOT NULL DEFAULT '[]',
    normalized_doi varchar(300),
    metadata_fingerprint varchar(64) NOT NULL CHECK(metadata_fingerprint ~ '^[a-f0-9]{64}$'),
    import_origin jsonb NOT NULL CHECK(jsonb_typeof(import_origin)='object'),
    created_by uuid NOT NULL REFERENCES users(id),
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    FOREIGN KEY(workspace_id,source_id) REFERENCES sources(workspace_id,id),
    CONSTRAINT ck_bibliography_items_metadata CHECK (
        jsonb_typeof(bibliography)='object'
        AND bibliography ?& ARRAY['title','authors','publicationYear','doi','venue','url','citationKey']
        AND source_text_list_valid(bibliography->'authors',100,200,false)
        AND source_text_list_valid(tags,20,80,true)
        AND source_text_list_valid(collections,20,80,true)
    )
);
CREATE UNIQUE INDEX uq_bibliography_items_doi ON bibliography_items(workspace_id,normalized_doi)
    WHERE normalized_doi IS NOT NULL;
CREATE UNIQUE INDEX uq_bibliography_items_fingerprint ON bibliography_items(workspace_id,metadata_fingerprint);
CREATE UNIQUE INDEX uq_bibliography_items_citation_key
    ON bibliography_items(workspace_id,lower(bibliography->>'citationKey'))
    WHERE bibliography->>'citationKey' IS NOT NULL;
CREATE INDEX ix_bibliography_items_workspace ON bibliography_items(workspace_id,created_at DESC,id DESC);
CREATE INDEX ix_bibliography_items_tags ON bibliography_items USING gin(tags jsonb_path_ops);
CREATE INDEX ix_bibliography_items_collections ON bibliography_items USING gin(collections jsonb_path_ops);

-- Accepted metadata and its destination are immutable provenance for each confirm decision.
CREATE TABLE bibliography_import_records (
    import_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    record_number integer NOT NULL CHECK(record_number BETWEEN 1 AND 1000),
    action varchar(24) NOT NULL CHECK(action IN ('CREATE','LINK_SOURCE','REPLACE_SOURCE','REPLACE_ITEM','SKIP','REJECT')),
    outcome varchar(24) NOT NULL CHECK(outcome IN ('CREATED','LINKED','UPDATED','SKIPPED','REJECTED','DUPLICATE')),
    accepted_metadata jsonb,
    target_kind varchar(24) CHECK(target_kind IN ('BIBLIOGRAPHIC_ITEM','SOURCE')),
    target_id uuid,
    created_at timestamptz NOT NULL,
    PRIMARY KEY(import_id,record_number),
    FOREIGN KEY(workspace_id,import_id) REFERENCES bibliography_imports(workspace_id,id),
    CHECK((target_kind IS NULL)=(target_id IS NULL)),
    CHECK(accepted_metadata IS NULL OR jsonb_typeof(accepted_metadata)='object')
);

CREATE FUNCTION bibliography_import_records_are_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF current_user='researchhub_erasure' AND TG_OP='DELETE' THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'bibliography import decisions are immutable' USING ERRCODE='restrict_violation';
END;
$$;
CREATE TRIGGER tg_bibliography_import_records_immutable BEFORE UPDATE OR DELETE ON bibliography_import_records
    FOR EACH ROW EXECUTE FUNCTION bibliography_import_records_are_immutable();

COMMENT ON TABLE bibliography_items IS
    'Bibliographic-only metadata. It has no SourceType, bytes, extraction, retrieval chunks, or automatic AI evidence.';
COMMENT ON COLUMN bibliography_items.source_id IS
    'Optional explicit relationship to an existing source; it does not create or fetch an attachment.';

CREATE TRIGGER z_erasure_publication BEFORE INSERT OR UPDATE ON bibliography_imports
    FOR EACH ROW EXECUTE FUNCTION reject_erased_workspace_publication();
CREATE TRIGGER z_erasure_publication BEFORE INSERT OR UPDATE ON bibliography_items
    FOR EACH ROW EXECUTE FUNCTION reject_erased_workspace_publication();
CREATE TRIGGER z_erasure_publication BEFORE INSERT OR UPDATE ON bibliography_import_records
    FOR EACH ROW EXECUTE FUNCTION reject_erased_workspace_publication();
GRANT SELECT,INSERT,UPDATE,DELETE ON bibliography_imports,bibliography_items,bibliography_import_records TO researchhub_erasure;
