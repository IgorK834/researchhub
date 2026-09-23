package dev.researchhub.workspace.application;

import java.util.UUID;

/**
 * Request to create a workspace.
 *
 * <p>{@code createdBy} is the authenticated caller, resolved by the API layer from the session. It is
 * deliberately a parameter of this command rather than a field a client can send: a request body that
 * could name its own creator would let one user create workspaces owned by another.
 */
public record CreateWorkspaceCommand(String name, String description, UUID createdBy) {
}
