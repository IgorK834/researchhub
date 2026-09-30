-- One current chunk set. Content remains in source_extractions; chunks store bounded provenance spans only.
CREATE TABLE source_retrieval_sets (
    source_id uuid PRIMARY KEY REFERENCES source_extractions(source_id),
    workspace_id uuid NOT NULL REFERENCES workspaces(id),
    job_id uuid NOT NULL REFERENCES processing_jobs(id),
    processing_version varchar(128) NOT NULL,
    chunk_count integer NOT NULL CHECK (chunk_count BETWEEN 0 AND 10000),
    metadata jsonb NOT NULL CHECK (jsonb_typeof(metadata) = 'object'),
    created_at timestamptz NOT NULL,
    UNIQUE(source_id, workspace_id, processing_version)
);
CREATE TABLE source_retrieval_chunks (
    chunk_id varchar(64) NOT NULL UNIQUE CHECK (chunk_id ~ '^[0-9a-f]{64}$'),
    source_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    source_version_id uuid CHECK (source_version_id IS NULL),
    chunk_index integer NOT NULL CHECK (chunk_index >= 0),
    page_start integer CHECK (page_start > 0),
    page_end integer CHECK (page_end > 0),
    section_title varchar(500),
    content_hash varchar(64) NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
    processing_version varchar(128) NOT NULL,
    spans jsonb NOT NULL CHECK (jsonb_typeof(spans) = 'array' AND jsonb_array_length(spans) BETWEEN 1 AND 10000),
    PRIMARY KEY(source_id, chunk_index),
    FOREIGN KEY(source_id, workspace_id, processing_version) REFERENCES source_retrieval_sets(source_id, workspace_id, processing_version),
    CHECK ((page_start IS NULL AND page_end IS NULL) OR (page_start IS NOT NULL AND page_end IS NOT NULL AND page_end >= page_start))
);
CREATE INDEX ix_source_retrieval_chunks_scope ON source_retrieval_chunks(workspace_id, processing_version, source_id);
ALTER TABLE source_extraction_runs ADD COLUMN retrieval_processing_version varchar(128);
ALTER TABLE source_extraction_runs ADD COLUMN chunking_config jsonb CHECK (chunking_config IS NULL OR jsonb_typeof(chunking_config) = 'object');
