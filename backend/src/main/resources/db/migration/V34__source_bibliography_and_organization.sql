-- Bound and validate JSON text lists for every database writer, as well as the Java domain.
CREATE FUNCTION source_text_list_valid(entries jsonb, max_count int, max_length int, normalized boolean)
RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
    SELECT CASE WHEN jsonb_typeof(entries) IS DISTINCT FROM 'array' THEN false
                WHEN jsonb_array_length(entries) > max_count THEN false
                ELSE NOT EXISTS (
                    SELECT 1 FROM jsonb_array_elements(entries) item
                    WHERE jsonb_typeof(item) <> 'string'
                       OR length(item #>> '{}') NOT BETWEEN 1 AND max_length
                       OR (item #>> '{}') <> btrim(item #>> '{}')
                       OR (item #>> '{}') ~ '[[:cntrl:]]'
                       OR (normalized AND (item #>> '{}') <> lower(item #>> '{}'))
                ) AND (NOT normalized OR jsonb_array_length(entries) = (
                    SELECT count(DISTINCT item) FROM jsonb_array_elements(entries) item
                )) END
$$;

-- Mutable descriptions belong to the stable source, independently of immutable uploaded versions.
ALTER TABLE sources
    ADD COLUMN bibliography jsonb NOT NULL DEFAULT '{"title":null,"authors":[],"publicationYear":null,"doi":null,"venue":null,"url":null,"citationKey":null}',
    ADD COLUMN tags jsonb NOT NULL DEFAULT '[]',
    ADD COLUMN collections jsonb NOT NULL DEFAULT '[]',
    ADD CONSTRAINT ck_sources_bibliography CHECK (
        jsonb_typeof(bibliography) = 'object'
        AND bibliography ?& ARRAY['title','authors','publicationYear','doi','venue','url','citationKey']
        AND source_text_list_valid(bibliography->'authors', 100, 200, false)
        AND jsonb_typeof(bibliography->'title') IN ('string', 'null')
        AND jsonb_typeof(bibliography->'venue') IN ('string', 'null')
        AND jsonb_typeof(bibliography->'doi') IN ('string', 'null')
        AND jsonb_typeof(bibliography->'url') IN ('string', 'null')
        AND jsonb_typeof(bibliography->'citationKey') IN ('string', 'null')
        AND CASE WHEN bibliography->>'publicationYear' IS NULL THEN true
                 WHEN jsonb_typeof(bibliography->'publicationYear') = 'number'
                      AND bibliography->>'publicationYear' ~ '^[0-9]{1,4}$'
                 THEN (bibliography->>'publicationYear')::int BETWEEN 1 AND 9999 ELSE false END
        AND length(coalesce(bibliography->>'title', '')) <= 1000
        AND length(coalesce(bibliography->>'venue', '')) <= 500
        AND length(coalesce(bibliography->>'doi', '')) <= 300
        AND length(coalesce(bibliography->>'url', '')) <= 2000
        AND (bibliography->>'citationKey' IS NULL OR bibliography->>'citationKey' ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$')
    ),
    ADD CONSTRAINT ck_sources_tags CHECK (source_text_list_valid(tags, 20, 80, true)),
    ADD CONSTRAINT ck_sources_collections CHECK (source_text_list_valid(collections, 20, 80, true));

CREATE UNIQUE INDEX uq_sources_workspace_citation_key
    ON sources (workspace_id, lower(bibliography->>'citationKey'))
    WHERE bibliography->>'citationKey' IS NOT NULL;
CREATE INDEX ix_sources_workspace_library ON sources (workspace_id, created_at DESC, id DESC);
CREATE INDEX ix_sources_workspace_type_status ON sources (workspace_id, source_type, status);
CREATE INDEX ix_sources_workspace_uploader ON sources (workspace_id, uploaded_by);
CREATE INDEX ix_sources_tags ON sources USING gin (tags jsonb_path_ops);
CREATE INDEX ix_sources_collections ON sources USING gin (collections jsonb_path_ops);
