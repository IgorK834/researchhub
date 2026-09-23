package dev.researchhub.workspace.api;

import dev.researchhub.workspace.application.WorkspaceSummary;

import java.time.Instant;
import java.util.UUID;

/**
 * A workspace as returned by {@code /api/workspaces}, including the role the caller holds in it.
 *
 * <p>Carries workspace metadata and one role, and nothing about any user: no email, no display name,
 * no credential, and no other member's role. The caller's own role is included because the client needs
 * it to render, and because it is information that caller already has by definition.
 *
 * <p>{@code description} is {@code null} when the workspace has none.
 */
public record WorkspaceResponse(
        UUID id,
        String name,
        String description,
        String role,
        Instant createdAt,
        Instant updatedAt
) {

    static WorkspaceResponse from(WorkspaceSummary summary) {
        return new WorkspaceResponse(
                summary.id(),
                summary.name(),
                summary.description(),
                summary.role(),
                summary.createdAt(),
                summary.updatedAt());
    }

}
