-- One receipt per room: retries are idempotent without an ever-growing update/receipt log.
ALTER TABLE collaboration_documents
    ADD COLUMN last_snapshot_id uuid,
    ADD COLUMN state_sha256 varchar(64),
    ADD CONSTRAINT ck_collaboration_snapshot_hash CHECK (state_sha256 IS NULL OR state_sha256 ~ '^[a-f0-9]{64}$'),
    ADD CONSTRAINT ck_collaboration_snapshot_receipt CHECK (last_snapshot_id IS NULL OR (state IS NOT NULL AND state_sha256 IS NOT NULL));
-- V25 snapshots remain readable. The application verifies/upgrades their hash under the document lock on load.
