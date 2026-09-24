package dev.researchhub.workspace.application;

/**
 * Request to add an existing user to a workspace.
 *
 * <p>The email identifies somebody who has already registered. Nothing is sent to it, and an address with
 * no account is not stored as a pending invitation — the add simply fails. Adding a member is therefore
 * never a way to find out whether an address has an account, because the answer is the same either way.
 *
 * <p>{@code role} is a {@link String} so this package can report an unusable value as
 * {@code VALIDATION_FAILED} rather than failing to construct the command. {@code OWNER} is refused here:
 * see {@link WorkspaceMembershipService#addMember}.
 */
public record AddWorkspaceMemberCommand(String email, String role) {
}
