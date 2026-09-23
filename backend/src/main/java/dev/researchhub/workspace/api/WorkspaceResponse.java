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
 * <p>{@code description} is {@code null} when the workspace has none. {@code archivedAt} is {@code null}
 * while the workspace is active, and a timestamp once it has been archived — so a client can render an
 * archived workspace as archived without asking a second question.
 *
 * <p>There is no {@code archivedBy} field. Who archived a workspace is recorded in the column for audit
 * purposes, and turning it into an API field would mean either exposing a user id the client cannot
 * resolve or resolving it into a profile, which would make this a response about people as well as
 * workspaces. Neither is needed to render the state.
 */
public record WorkspaceResponse(
        UUID id,
        String name,
        String description,
        String role,
        Instant createdAt,
        Instant updatedAt,
        Instant archivedAt
) {

    static WorkspaceResponse from(WorkspaceSummary summary) {
        return new WorkspaceResponse(
                summary.id(),
                summary.name(),
                summary.description(),
                summary.role(),
                summary.createdAt(),
                summary.updatedAt(),
                summary.archivedAt());
    }

}
