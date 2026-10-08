-- Transient admission counters, independent of resource lifecycle and business transactions.
CREATE TABLE cost_quota_bucket (
    scope_type varchar(16) NOT NULL CHECK (scope_type IN ('USER', 'WORKSPACE')),
    scope_id uuid NOT NULL,
    category varchar(16) NOT NULL CHECK (category IN ('LLM', 'ANALYSIS', 'RETRIEVAL')),
    window_start timestamptz NOT NULL,
    request_count integer NOT NULL CHECK (request_count > 0),
    updated_at timestamptz NOT NULL,
    CONSTRAINT uq_cost_quota_bucket UNIQUE (scope_type, scope_id, category, window_start)
);

CREATE INDEX ix_cost_quota_bucket_cleanup ON cost_quota_bucket (window_start);
