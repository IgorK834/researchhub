package dev.researchhub.workspace.domain;

import java.time.Instant;
import java.util.Objects;
import java.util.UUID;

/**
 * One user's membership of one workspace, and the role it grants.
 *
 * <p>This is the only thing that grants access to a workspace. A user with no membership is not a
 * member, and the API is careful not to confirm that such a workspace exists at all.
 *
 * <p>Both ids are bare {@link UUID}s: the row links a user to a workspace and stores nothing else
 * about either, so no user column is duplicated here and this module does not import
 * {@code user.domain}.
 */
public record WorkspaceMembership(
        UUID id,
        UUID workspaceId,
        UUID userId,
        WorkspaceRole role,
        Instant createdAt
) {

    public WorkspaceMembership {
        Objects.requireNonNull(workspaceId, "workspaceId must not be null");
        Objects.requireNonNull(userId, "userId must not be null");
        Objects.requireNonNull(role, "role must not be null");
        Objects.requireNonNull(createdAt, "createdAt must not be null");
    }

    /** Creates a membership that has not been persisted yet. */
    public static WorkspaceMembership create(UUID workspaceId, UUID userId, WorkspaceRole role, Instant now) {
        return new WorkspaceMembership(null, workspaceId, userId, role, now);
    }

    /** Returns a copy carrying {@code newRole}. Nothing else about the membership changes. */
    public WorkspaceMembership withRole(WorkspaceRole newRole) {
        return new WorkspaceMembership(id, workspaceId, userId, newRole, createdAt);
    }

    /** True when this membership carries {@code capability}. */
    public boolean allows(WorkspaceCapability capability) {
        return role.allows(capability);
    }

}
