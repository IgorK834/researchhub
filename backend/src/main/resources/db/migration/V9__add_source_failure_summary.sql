-- A concise, user-safe explanation of a processing failure belongs to source metadata. It is deliberately not a
-- stack trace or raw processor output: list/detail responses may show it to every member of the workspace.

ALTER TABLE sources
    ADD COLUMN failure_summary varchar(1000);

-- V8 allowed FAILED before there was a place to retain its explanation. Make an upgrade safe even if another
-- component already moved a row to FAILED before this migration is deployed.
UPDATE sources
SET failure_summary = 'Processing failed; no diagnostic summary was recorded.'
WHERE status = 'FAILED';

ALTER TABLE sources
    ADD CONSTRAINT ck_sources_failure_summary_matches_status CHECK (
        (status = 'FAILED' AND failure_summary IS NOT NULL AND length(btrim(failure_summary)) > 0)
            OR (status <> 'FAILED' AND failure_summary IS NULL)
        );

COMMENT ON COLUMN sources.failure_summary IS
    'Short, user-safe processing failure explanation. Present exactly when status is FAILED; never a stack trace.';
