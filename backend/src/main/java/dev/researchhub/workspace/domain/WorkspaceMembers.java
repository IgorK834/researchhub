package dev.researchhub.workspace.domain;

import dev.researchhub.shared.error.ConflictException;
import dev.researchhub.shared.error.ResourceNotFoundException;

import java.util.HashSet;
import java.util.List;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

/**
 * Every membership of one workspace, and the rules for changing them.
 *
 * <p>Exists because the interesting membership rules are about the <em>set</em> of members, not about
 * one row. "A workspace always has at least one owner" cannot be checked by a single
 * {@link WorkspaceMembership}, so a type that holds them all is what can enforce it. That rule is
 * enforced here, in {@code domain}, rather than in a service or a controller, so it holds for every
 * caller — including the member-management endpoints that do not exist yet.
 *
 * <p>Both mutating methods are pure: they return the membership the caller should then persist or
 * delete, and never touch a repository. Deciding and writing stay separate, which is what lets the
 * rule be tested without a database.
 *
 * <p>The list is copied on construction, so a caller cannot change the set after the checks have run.
 */
public record WorkspaceMembers(UUID workspaceId, List<WorkspaceMembership> memberships) {

    public WorkspaceMembers {
        Objects.requireNonNull(workspaceId, "workspaceId must not be null");
        memberships = List.copyOf(Objects.requireNonNull(memberships, "memberships must not be null"));

        if (memberships.isEmpty()) {
            throw new IllegalArgumentException("a workspace always has at least one member");
        }

        Set<UUID> userIds = new HashSet<>();
        for (WorkspaceMembership membership : memberships) {
            if (!workspaceId.equals(membership.workspaceId())) {
                throw new IllegalArgumentException(
                        "membership " + membership.userId() + " belongs to another workspace");
            }
            if (!userIds.add(membership.userId())) {
                // uq_workspace_members_workspace_user makes this unreachable from the database. It is
                // checked anyway so an in-memory caller cannot build a set with two conflicting roles
                // for one user and get an undefined answer from roleOf.
                throw new IllegalArgumentException(
                        "user " + membership.userId() + " has more than one membership");
            }
        }
    }

    /** The membership for {@code userId}, or empty when that user is not a member. */
    public Optional<WorkspaceMembership> forUser(UUID userId) {
        return memberships.stream()
                .filter(membership -> membership.userId().equals(userId))
                .findFirst();
    }

    /** The role {@code userId} holds here, or empty when that user is not a member. */
    public Optional<WorkspaceRole> roleOf(UUID userId) {
        return forUser(userId).map(WorkspaceMembership::role);
    }

    /** How many members currently hold {@link WorkspaceRole#OWNER}. */
    public long ownerCount() {
        return memberships.stream()
                .filter(membership -> membership.role() == WorkspaceRole.OWNER)
                .count();
    }

    /**
     * Returns {@code userId}'s membership carrying {@code newRole}, for the caller to persist.
     *
     * @throws ResourceNotFoundException when {@code userId} is not a member
     * @throws ConflictException         when this would demote the last owner
     */
    public WorkspaceMembership changeRole(UUID userId, WorkspaceRole newRole) {
        Objects.requireNonNull(newRole, "newRole must not be null");
        WorkspaceMembership membership = requireMembership(userId);

        if (membership.role() == newRole) {
            return membership;
        }
        if (membership.role() == WorkspaceRole.OWNER) {
            requireAnotherOwnerRemains();
        }
        return membership.withRole(newRole);
    }

    /**
     * Returns the membership to delete for {@code userId}.
     *
     * @throws ResourceNotFoundException when {@code userId} is not a member
     * @throws ConflictException         when this would remove the last owner
     */
    public WorkspaceMembership remove(UUID userId) {
        WorkspaceMembership membership = requireMembership(userId);

        if (membership.role() == WorkspaceRole.OWNER) {
            requireAnotherOwnerRemains();
        }
        return membership;
    }

    private WorkspaceMembership requireMembership(UUID userId) {
        return forUser(userId).orElseThrow(
                () -> new ResourceNotFoundException("Workspace member was not found"));
    }

    /**
     * Refuses a change that would leave the workspace with no owner.
     *
     * <p>An ownerless workspace is unmanageable: nobody could add a member, change a role, or archive
     * it, and no endpoint could repair that from outside. So the last owner cannot step down or be
     * removed — they have to promote someone else first.
     */
    private void requireAnotherOwnerRemains() {
        if (ownerCount() <= 1) {
            throw new ConflictException(
                    "A workspace must always have at least one owner. Promote another member first.");
        }
    }

}
