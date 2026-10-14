-- Creation receipts are immutable; editing a normal document never updates its bundled-template origin.
CREATE TABLE document_template_creations (
    workspace_id uuid NOT NULL,
    created_by uuid NOT NULL REFERENCES users(id),
    client_request_id uuid NOT NULL,
    request_sha256 varchar(64) NOT NULL CHECK(request_sha256 ~ '^[a-f0-9]{64}$'),
    document_id uuid NOT NULL UNIQUE,
    template_id varchar(40) NOT NULL,
    template_version integer NOT NULL CHECK(template_version>0),
    locale varchar(2) NOT NULL CHECK(locale IN ('en','pl')),
    template_sha256 varchar(64) NOT NULL CHECK(template_sha256 ~ '^[a-f0-9]{64}$'),
    content_sha256 varchar(64) NOT NULL CHECK(content_sha256 ~ '^[a-f0-9]{64}$'),
    created_at timestamptz NOT NULL,
    PRIMARY KEY(workspace_id,created_by,client_request_id),
    FOREIGN KEY(workspace_id,document_id) REFERENCES documents(workspace_id,id)
);
CREATE TRIGGER document_template_creations_immutable BEFORE UPDATE OR DELETE ON document_template_creations
    FOR EACH ROW EXECUTE FUNCTION review_history_is_immutable();
CREATE TRIGGER z_erasure_publication BEFORE INSERT OR UPDATE ON document_template_creations
    FOR EACH ROW EXECUTE FUNCTION reject_erased_workspace_publication();
GRANT SELECT,DELETE ON document_template_creations TO researchhub_erasure;
DO $$ DECLARE definition text; BEGIN
    SELECT pg_get_functiondef('public.finish_account_erasure(uuid)'::regprocedure) INTO definition;
    definition:=replace(definition,'SET CONSTRAINTS ALL DEFERRED;',
        'SET CONSTRAINTS ALL DEFERRED; DELETE FROM public.document_template_creations WHERE workspace_id=ANY(job.workspace_ids);');
    EXECUTE format('GRANT researchhub_erasure TO %I',current_user);
    GRANT CREATE ON SCHEMA public TO researchhub_erasure;
    EXECUTE definition;
    REVOKE CREATE ON SCHEMA public FROM researchhub_erasure;
    EXECUTE format('REVOKE researchhub_erasure FROM %I',current_user);
END $$;
