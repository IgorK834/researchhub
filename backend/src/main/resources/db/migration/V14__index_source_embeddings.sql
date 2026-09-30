-- Explicit model namespaces allow a rolling rebuild without comparing incompatible spaces.
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public;
CREATE TABLE retrieval_embedding_models (
    index_id varchar(64) PRIMARY KEY CHECK (index_id ~ '^[0-9a-f]{64}$'),
    provider varchar(128) NOT NULL,
    model_name varchar(128) NOT NULL,
    model_version varchar(128) NOT NULL,
    dimension integer NOT NULL CHECK (dimension BETWEEN 1 AND 4096),
    UNIQUE(index_id, dimension),
    UNIQUE(provider, model_name, model_version, dimension)
);
ALTER TABLE source_retrieval_chunks ADD CONSTRAINT uq_retrieval_chunk_scope UNIQUE(chunk_id, workspace_id, source_id, processing_version);
CREATE TABLE source_chunk_embeddings (
    chunk_id varchar(64) PRIMARY KEY,
    workspace_id uuid NOT NULL,
    source_id uuid NOT NULL,
    processing_version varchar(128) NOT NULL,
    index_id varchar(64) NOT NULL,
    dimension integer NOT NULL,
    embedding public.vector NOT NULL,
    content text NOT NULL CHECK (length(content) BETWEEN 1 AND 8000),
    lexical tsvector GENERATED ALWAYS AS (to_tsvector('simple'::regconfig, content)) STORED,
    FOREIGN KEY (index_id, dimension) REFERENCES retrieval_embedding_models(index_id, dimension),
    FOREIGN KEY (source_id, workspace_id, processing_version) REFERENCES source_retrieval_sets(source_id, workspace_id, processing_version),
    FOREIGN KEY (chunk_id, workspace_id, source_id, processing_version) REFERENCES source_retrieval_chunks(chunk_id, workspace_id, source_id, processing_version) ON DELETE CASCADE,
    CHECK (public.vector_dims(embedding) = dimension)
);
CREATE INDEX ix_source_embeddings_scope ON source_chunk_embeddings(workspace_id, index_id, source_id);
CREATE INDEX ix_source_embeddings_lexical ON source_chunk_embeddings USING gin(lexical);
ALTER TABLE processing_jobs ADD COLUMN stage varchar(16) CHECK (stage IN ('EXTRACT','CHUNK','EMBED','INDEX','FINALIZE'));
