-- Workspace archival: retire a workspace without destroying anything.
--
-- Archiving is a soft state change, deliberately. docs/context.md sections 3.3 and 3.4 require sources,
-- documents, and analysis results to stay traceable, so a workspace leaving active use must not take its
-- history with it. Nothing here deletes a row, and nothing cascades: archiving sets two columns and
-- stops.
--
-- The consequence for reads is in the application, not here. GET /api/workspaces filters
-- archived_at IS NULL so an archived workspace leaves the list, while GET /api/workspaces/{id} still
-- returns it to its members with archivedAt set. A non-member gets the same 404 either way.
--
-- Future workspace-owned tables (documents, sources, analyses, AI conversations, audit events) reference
-- workspaces without ON DELETE CASCADE, and archiving must not remove their rows or their stored files.
-- See docs/development/persistence.md.

ALTER TABLE workspaces
    -- NULL means active. Set once, when the workspace is archived; archiving again is a no-op that keeps
    -- the original timestamp, so this column records when it actually happened.
    ADD COLUMN archived_at timestamptz,
    -- Who archived it. A plain uuid column like created_by, not a mapped association: the `workspace`
    -- module must not import user.infrastructure (docs/development/backend-architecture.md). It is not
    -- exposed by the API as a user profile.
    ADD COLUMN archived_by uuid;

ALTER TABLE workspaces
    ADD CONSTRAINT fk_workspaces_archived_by FOREIGN KEY (archived_by) REFERENCES users (id),

    -- The two columns describe one event, so a row recording half of it is meaningless: an archived_at
    -- with no actor, or an actor with no time, would both be states no application path can produce and
    -- no reader could interpret. `IS NULL` yields true or false and never NULL, so this comparison is
    -- well defined for every row.
    ADD CONSTRAINT ck_workspaces_archived_together
        CHECK ((archived_at IS NULL) = (archived_by IS NULL));

-- Existing rows keep archived_at NULL, which is exactly "active". No backfill is needed, and no UPDATE
-- is issued here.

COMMENT ON COLUMN workspaces.archived_at IS
    'When the workspace was archived. NULL means active. Archiving never deletes rows or files.';

COMMENT ON COLUMN workspaces.archived_by IS
    'The user who archived the workspace. Set together with archived_at.';
