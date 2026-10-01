-- RH-130: a source is the stable workspace object; source_versions are immutable uploaded inputs.
-- Existing rows become version 1 without moving or rewriting their blobs.
CREATE TABLE source_versions
(
    id                uuid         NOT NULL,
    source_id         uuid         NOT NULL REFERENCES sources (id),
    workspace_id      uuid         NOT NULL REFERENCES workspaces (id),
    version_number    integer      NOT NULL CHECK (version_number >= 1),
    original_filename varchar(255) NOT NULL CHECK (length(btrim(original_filename)) > 0),
    media_type        varchar(128) NOT NULL,
    source_type       varchar(16)  NOT NULL CHECK (source_type IN ('PDF', 'DOCX', 'XLSX', 'CSV', 'TXT')),
    size_bytes        bigint       NOT NULL CHECK (size_bytes BETWEEN 1 AND 1073741824),
    storage_key       varchar(255) NOT NULL UNIQUE
        CHECK (storage_key ~ '^sources/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
    content_sha256    varchar(64)  NOT NULL CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
    status            varchar(16)  NOT NULL CHECK (status IN ('UPLOADED', 'PROCESSING', 'READY', 'FAILED')),
    failure_summary   varchar(1000),
    uploaded_by       uuid         NOT NULL REFERENCES users (id),
    created_at        timestamptz  NOT NULL,
    updated_at        timestamptz  NOT NULL,

    CONSTRAINT pk_source_versions PRIMARY KEY (id),
    CONSTRAINT uq_source_versions_number UNIQUE (source_id, version_number),
    CONSTRAINT uq_source_versions_scope UNIQUE (id, source_id, workspace_id),
    CONSTRAINT ck_source_versions_media_type CHECK (
        (source_type = 'PDF' AND media_type = 'application/pdf')
            OR (source_type = 'DOCX' AND media_type = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
            OR (source_type = 'XLSX' AND media_type = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
            OR (source_type = 'CSV' AND media_type = 'text/csv')
            OR (source_type = 'TXT' AND media_type = 'text/plain')
    ),
    CONSTRAINT ck_source_versions_failure CHECK (
        (status = 'FAILED' AND failure_summary IS NOT NULL AND length(btrim(failure_summary)) > 0)
            OR (status <> 'FAILED' AND failure_summary IS NULL)
    )
);

CREATE INDEX ix_source_versions_source ON source_versions (workspace_id, source_id, version_number DESC);

INSERT INTO source_versions(id, source_id, workspace_id, version_number, original_filename, media_type,
                            source_type, size_bytes, storage_key, content_sha256, status, failure_summary,
                            uploaded_by, created_at, updated_at)
SELECT gen_random_uuid(), id, workspace_id, 1, original_filename, media_type, source_type, size_bytes,
       storage_key, content_sha256, status, failure_summary, uploaded_by, created_at, updated_at
FROM sources;

ALTER TABLE sources ADD COLUMN active_version_id uuid;
ALTER TABLE sources ADD COLUMN active_version_number integer;
UPDATE sources s
SET active_version_id = v.id, active_version_number = v.version_number
FROM source_versions v
WHERE v.source_id = s.id AND v.version_number = 1;
ALTER TABLE sources ALTER COLUMN active_version_id SET NOT NULL;
ALTER TABLE sources ALTER COLUMN active_version_number SET NOT NULL;
ALTER TABLE sources ADD CONSTRAINT ck_sources_active_version_number CHECK (active_version_number >= 1);
ALTER TABLE sources ADD CONSTRAINT fk_sources_active_version
    FOREIGN KEY (active_version_id, id, workspace_id)
    REFERENCES source_versions (id, source_id, workspace_id) DEFERRABLE INITIALLY DEFERRED;

-- Stable source identity is immutable. Active-file columns may move only as one complete projection of
-- the selected immutable version; this keeps older readers compatible without making the source row the archive.
CREATE OR REPLACE FUNCTION sources_original_is_immutable() RETURNS trigger
    LANGUAGE plpgsql AS
$$
DECLARE
    selected source_versions%ROWTYPE;
BEGIN
    IF NEW.id IS DISTINCT FROM OLD.id
        OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
        OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
        RAISE EXCEPTION 'source identity is immutable for source %', OLD.id USING ERRCODE = 'restrict_violation';
    END IF;

    SELECT * INTO selected FROM source_versions WHERE id = NEW.active_version_id;
    IF NOT FOUND
        OR selected.source_id IS DISTINCT FROM NEW.id
        OR selected.workspace_id IS DISTINCT FROM NEW.workspace_id
        OR selected.version_number IS DISTINCT FROM NEW.active_version_number
        OR selected.original_filename IS DISTINCT FROM NEW.original_filename
        OR selected.media_type IS DISTINCT FROM NEW.media_type
        OR selected.source_type IS DISTINCT FROM NEW.source_type
        OR selected.size_bytes IS DISTINCT FROM NEW.size_bytes
        OR selected.storage_key IS DISTINCT FROM NEW.storage_key
        OR selected.content_sha256 IS DISTINCT FROM NEW.content_sha256
        OR selected.uploaded_by IS DISTINCT FROM NEW.uploaded_by THEN
        RAISE EXCEPTION 'active source % must project one of its immutable versions', OLD.id
            USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
END;
$$;

CREATE FUNCTION source_version_input_is_immutable() RETURNS trigger
    LANGUAGE plpgsql AS
$$
BEGIN
    IF NEW.id IS DISTINCT FROM OLD.id
        OR NEW.source_id IS DISTINCT FROM OLD.source_id
        OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
        OR NEW.version_number IS DISTINCT FROM OLD.version_number
        OR NEW.original_filename IS DISTINCT FROM OLD.original_filename
        OR NEW.media_type IS DISTINCT FROM OLD.media_type
        OR NEW.source_type IS DISTINCT FROM OLD.source_type
        OR NEW.size_bytes IS DISTINCT FROM OLD.size_bytes
        OR NEW.storage_key IS DISTINCT FROM OLD.storage_key
        OR NEW.content_sha256 IS DISTINCT FROM OLD.content_sha256
        OR NEW.uploaded_by IS DISTINCT FROM OLD.uploaded_by
        OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
        RAISE EXCEPTION 'uploaded input is immutable for source version %', OLD.id
            USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER tg_source_version_input_is_immutable
    BEFORE UPDATE OR DELETE ON source_versions
    FOR EACH ROW EXECUTE FUNCTION source_version_input_is_immutable();

-- A durable job resolves the version captured when it was enqueued, never whichever version happens to be active
-- when a retry reaches the worker.
CREATE TABLE processing_job_source_versions
(
    job_id            uuid PRIMARY KEY REFERENCES processing_jobs (id),
    source_version_id uuid NOT NULL REFERENCES source_versions (id)
);
INSERT INTO processing_job_source_versions(job_id, source_version_id)
SELECT j.id, s.active_version_id
FROM processing_jobs j JOIN sources s ON s.id = j.resource_id AND s.workspace_id = j.workspace_id
WHERE j.job_type = 'SOURCE_INGEST' AND j.resource_type = 'SOURCE';
CREATE INDEX ix_processing_job_source_versions_version ON processing_job_source_versions(source_version_id);

-- Keep the complete validated extraction per immutable version. source_extractions remains the active projection
-- used by existing retrieval code and is replaced only after a new version successfully validates.
CREATE TABLE source_version_extractions
(
    source_version_id uuid PRIMARY KEY REFERENCES source_versions (id),
    source_id         uuid NOT NULL REFERENCES sources (id),
    workspace_id      uuid NOT NULL REFERENCES workspaces (id),
    job_id            uuid NOT NULL REFERENCES processing_jobs (id),
    parser_version    varchar(128) NOT NULL,
    content_sha256    varchar(64) NOT NULL CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
    payload           jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
    created_at        timestamptz NOT NULL,
    processing_version varchar(128) NOT NULL,
    schema_version    varchar(16) NOT NULL,
    payload_sha256    varchar(64) CHECK (payload_sha256 IS NULL OR payload_sha256 ~ '^[0-9a-f]{64}$'),
    UNIQUE(source_version_id, source_id, workspace_id)
);
INSERT INTO source_version_extractions(source_version_id, source_id, workspace_id, job_id, parser_version,
                                       content_sha256, payload, created_at, processing_version, schema_version,
                                       payload_sha256)
SELECT s.active_version_id, e.source_id, e.workspace_id, e.job_id, e.parser_version, e.content_sha256,
       e.payload, e.created_at, e.processing_version, e.schema_version,
       e.payload_sha256
FROM source_extractions e JOIN sources s ON s.id = e.source_id;
CREATE INDEX ix_source_version_extractions_scope
    ON source_version_extractions(workspace_id, source_id, source_version_id);

ALTER TABLE source_extraction_runs ADD COLUMN source_version_id uuid;
UPDATE source_extraction_runs r SET source_version_id = j.source_version_id
FROM processing_job_source_versions j WHERE j.job_id = r.job_id;
ALTER TABLE source_extraction_runs ALTER COLUMN source_version_id SET NOT NULL;
ALTER TABLE source_extraction_runs ADD CONSTRAINT fk_extraction_runs_source_version
    FOREIGN KEY(source_version_id) REFERENCES source_versions(id);

-- Retrieval output now carries the concrete input version. The active projection may still be rebuilt, while a
-- compact full JSON snapshot supports an explicitly original-version follow-up without retaining another blob.
ALTER TABLE source_retrieval_chunks
    DROP CONSTRAINT IF EXISTS source_retrieval_chunks_source_version_id_check;
UPDATE source_retrieval_chunks c SET source_version_id = s.active_version_id
FROM sources s WHERE s.id = c.source_id;
ALTER TABLE source_retrieval_chunks ALTER COLUMN source_version_id SET NOT NULL;
ALTER TABLE source_retrieval_chunks ADD CONSTRAINT fk_retrieval_chunks_source_version
    FOREIGN KEY(source_version_id) REFERENCES source_versions(id);

CREATE TABLE source_version_retrieval_sets
(
    source_version_id uuid PRIMARY KEY REFERENCES source_versions(id),
    source_id         uuid NOT NULL REFERENCES sources(id),
    workspace_id      uuid NOT NULL REFERENCES workspaces(id),
    job_id            uuid NOT NULL REFERENCES processing_jobs(id),
    processing_version varchar(128) NOT NULL,
    payload           jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object' AND octet_length(payload::text) <= 4194304),
    created_at        timestamptz NOT NULL,
    UNIQUE(source_version_id, source_id, workspace_id)
);
CREATE INDEX ix_source_version_retrieval_scope
    ON source_version_retrieval_sets(workspace_id, source_id, source_version_id);

-- Archive the current retrieval set of every existing source as the snapshot of its version 1, rebuilding the chunk
-- text from the stored extraction exactly as the application does (spans joined by a blank line). Without it an
-- analysis created before versioning could not be reproduced once its source is replaced. A set that would exceed the
-- table's size bound is skipped rather than failing the migration; its analyses then fail safely as "evidence changed".
WITH rebuilt AS (
    SELECT s.active_version_id AS source_version_id, r.source_id, r.workspace_id, r.job_id, r.processing_version,
           r.created_at,
           jsonb_set(r.metadata, '{sourceVersionId}', to_jsonb(s.active_version_id::text))
               || jsonb_build_object('chunks', COALESCE((
                   SELECT jsonb_agg(jsonb_build_object(
                       'chunkId', c.chunk_id, 'sourceId', c.source_id, 'workspaceId', c.workspace_id,
                       'sourceVersionId', s.active_version_id, 'chunkIndex', c.chunk_index,
                       'content', (
                           SELECT string_agg(
                               substring(un.unit ->> 'text'
                                         FROM ((sp.span ->> 'characterStart')::int - (un.unit ->> 'characterStart')::int) + 1
                                         FOR (sp.span ->> 'characterEnd')::int - (sp.span ->> 'characterStart')::int),
                               E'\n\n' ORDER BY sp.ord)
                           FROM jsonb_array_elements(c.spans) WITH ORDINALITY sp(span, ord)
                           JOIN LATERAL (SELECT u AS unit FROM jsonb_array_elements(e.payload -> 'chunks') u
                                         WHERE u ->> 'chunkId' = sp.span ->> 'unitId' LIMIT 1) un ON true),
                       'pageStart', c.page_start, 'pageEnd', c.page_end, 'sectionTitle', c.section_title,
                       'contentHash', c.content_hash, 'processingVersion', c.processing_version, 'spans', c.spans)
                       ORDER BY c.chunk_index)
                   FROM source_retrieval_chunks c
                   WHERE c.source_id = r.source_id AND c.workspace_id = r.workspace_id), '[]'::jsonb)) AS payload
    FROM source_retrieval_sets r
    JOIN sources s ON s.id = r.source_id AND s.workspace_id = r.workspace_id
    JOIN source_extractions e ON e.source_id = r.source_id AND e.workspace_id = r.workspace_id AND e.job_id = r.job_id
)
INSERT INTO source_version_retrieval_sets(source_version_id, source_id, workspace_id, job_id, processing_version,
                                          payload, created_at)
SELECT source_version_id, source_id, workspace_id, job_id, processing_version, payload, created_at
FROM rebuilt
WHERE jsonb_typeof(payload) = 'object' AND octet_length(payload::text) <= 4194304;

-- Analyses keep relational, inspectable provenance in addition to their immutable render payload.
CREATE TABLE ai_source_analysis_sources
(
    analysis_id       uuid NOT NULL REFERENCES ai_source_analyses(id),
    source_id         uuid NOT NULL REFERENCES sources(id),
    source_version_id uuid NOT NULL REFERENCES source_versions(id),
    ordinal           integer NOT NULL CHECK (ordinal BETWEEN 0 AND 4),
    PRIMARY KEY(analysis_id, source_id),
    UNIQUE(analysis_id, ordinal)
);
INSERT INTO ai_source_analysis_sources(analysis_id, source_id, source_version_id, ordinal)
SELECT a.id, (item.value ->> 'id')::uuid, s.active_version_id, item.ordinality - 1
FROM ai_source_analyses a
CROSS JOIN LATERAL jsonb_array_elements(a.payload -> 'sources') WITH ORDINALITY item(value, ordinality)
JOIN sources s ON s.id = (item.value ->> 'id')::uuid AND s.workspace_id = a.workspace_id;

COMMENT ON TABLE source_versions IS
    'Immutable uploaded inputs. Blob deletion is forbidden while the row exists; analyses reference these ids.';
COMMENT ON COLUMN sources.active_version_id IS
    'Latest uploaded version exposed by the stable source identity.';
