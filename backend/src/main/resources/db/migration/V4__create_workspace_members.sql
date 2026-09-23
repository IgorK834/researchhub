-- Workspace members: how a user joins a workspace, and with which role.
--
-- Owned by the `workspace` module (dev.researchhub.workspace). This table is the only thing that
-- grants access to a workspace and to the entities that will hang off it. A user with no row here
-- must not be able to tell whether a given workspace exists, which is why the API answers 404 rather
-- than 403 for a non-member; see docs/development/backend-architecture.md.
--
-- Roles come from docs/context.md section 8. The capability each role carries is decided in
-- dev.researchhub.workspace.domain.WorkspaceRole, not here: this constraint only keeps unknown role
-- values out of the column.
--
-- Ids follow the same application-generated UUID v7 strategy as every other table, so there is no
-- DEFAULT on `id`.

CREATE TABLE workspace_members
(
    id           uuid        NOT NULL,
    workspace_id uuid        NOT NULL,
    -- A plain uuid column rather than a mapped association, for the same module-boundary reason as
    -- workspaces.created_by. Name and email are never copied here; they belong to the `user` module.
    user_id      uuid        NOT NULL,
    role         varchar(32) NOT NULL,
    created_at   timestamptz NOT NULL,

    CONSTRAINT pk_workspace_members PRIMARY KEY (id),

    -- One membership per user per workspace. The database is what actually guarantees this: two
    -- concurrent grants for the same person collide here even if an application-level check races,
    -- and without it a user could hold two rows with conflicting roles and no defined winner.
    CONSTRAINT uq_workspace_members_workspace_user UNIQUE (workspace_id, user_id),

    -- Widening WorkspaceRole requires widening this constraint in a new migration, the same way
    -- ck_users_status pins UserStatus.
    CONSTRAINT ck_workspace_members_role CHECK (role IN ('OWNER', 'EDITOR', 'VIEWER')),

    CONSTRAINT fk_workspace_members_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces (id),
    CONSTRAINT fk_workspace_members_user FOREIGN KEY (user_id) REFERENCES users (id)
);

-- "Which workspaces does this user belong to" is the query behind GET /api/workspaces, and it is the
-- only way that list is built. uq_workspace_members_workspace_user already provides the index for
-- lookups that lead with workspace_id, so only user_id needs its own.
CREATE INDEX ix_workspace_members_user_id ON workspace_members (user_id);

COMMENT ON TABLE workspace_members IS
    'Grants a user access to one workspace with one role. A user with no row here is not a member.';
