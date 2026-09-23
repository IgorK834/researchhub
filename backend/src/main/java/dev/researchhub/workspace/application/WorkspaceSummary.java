package dev.researchhub.workspace.application;

import dev.researchhub.workspace.domain.Workspace;
import dev.researchhub.workspace.domain.WorkspaceRole;

import java.time.Instant;
import java.util.UUID;

/**
 * A workspace as one member sees it: its metadata plus the role that member holds in it.
 *
 * <p>The role travels with the workspace because it is what the caller's own view depends on, and
 * returning it saves the client a second request to find out what it may do. It is the caller's role,
 * never anyone else's — this type exposes no other member, and no user's email, name, or credential.
 *
 * <p>{@code role} is a {@link String} rather than {@link WorkspaceRole} for the same reason
 * {@code UserAccount.status} is: returning the enum would force every reader of this package,
 * including {@code workspace.api}, to import {@code workspace.domain}, and the documented layering
 * only allows {@code api} to depend on {@code application}
 * (docs/development/backend-architecture.md).
 */
public record WorkspaceSummary(
        UUID id,
        String name,
        String description,
        String role,
        Instant createdAt,
        Instant updatedAt,
        Instant archivedAt
) {

    static WorkspaceSummary from(Workspace workspace, WorkspaceRole role) {
        return new WorkspaceSummary(
                workspace.id(),
                workspace.name(),
                workspace.description(),
                role.name(),
                workspace.createdAt(),
                workspace.updatedAt(),
                workspace.archivedAt());
    }

    /** True when this workspace has been archived. */
    public boolean isArchived() {
        return archivedAt != null;
    }

}
