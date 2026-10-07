-- RH-185: retain correlation across asynchronous claims, retries and restarts.
ALTER TABLE processing_jobs ADD COLUMN request_id varchar(64);
UPDATE processing_jobs SET request_id = id::text;
ALTER TABLE processing_jobs ALTER COLUMN request_id SET NOT NULL;
ALTER TABLE processing_jobs ALTER COLUMN request_id SET DEFAULT gen_random_uuid()::text;
ALTER TABLE processing_jobs ADD CONSTRAINT ck_processing_request_id
    CHECK (request_id ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$');

ALTER TABLE analysis_executions ADD COLUMN request_id varchar(64);
-- Completed attempts cannot be updated by the existing immutable-attempt trigger.
-- Historical rows use their execution ID as correlation; all new rows get an explicit value.
ALTER TABLE analysis_executions ALTER COLUMN request_id SET DEFAULT gen_random_uuid()::text;
ALTER TABLE analysis_executions ADD CONSTRAINT ck_execution_request_id
    CHECK (request_id IS NULL OR request_id ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$');

CREATE FUNCTION preserve_request_correlation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.request_id IS DISTINCT FROM OLD.request_id THEN
        RAISE EXCEPTION 'request correlation is immutable' USING ERRCODE='restrict_violation';
    END IF;
    RETURN NEW;
END; $$;
CREATE TRIGGER tg_processing_correlation BEFORE UPDATE ON processing_jobs
    FOR EACH ROW EXECUTE FUNCTION preserve_request_correlation();
CREATE TRIGGER tg_execution_correlation BEFORE UPDATE ON analysis_executions
    FOR EACH ROW EXECUTE FUNCTION preserve_request_correlation();
