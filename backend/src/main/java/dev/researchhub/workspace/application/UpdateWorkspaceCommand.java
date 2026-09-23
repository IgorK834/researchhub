package dev.researchhub.workspace.application;

/**
 * Request to change a workspace's metadata.
 *
 * <p>Carries only the two editable fields. The workspace id and the caller are parameters of
 * {@link WorkspaceService#updateMetadata}, not fields here: one identifies the row and the other is the
 * authenticated identity, and neither is payload a client gets to shape.
 *
 * <p>Both fields are applied. This is a replacement of the metadata, not a merge of the fields that
 * happen to be present — see {@code UpdateWorkspaceRequest} for why, and for what a blank description
 * means.
 */
public record UpdateWorkspaceCommand(String name, String description) {
}
