package dev.researchhub.workspace.api;

import dev.researchhub.workspace.application.WorkspaceMemberSummary;

import java.util.UUID;

/**
 * One workspace member on the wire.
 *
 * <p>Exactly four fields: {@code userId}, {@code email}, {@code displayName}, and {@code role}. No password,
 * no hash, no {@code normalizedEmail}, and no account status. The type has no field for any of them, so none
 * can leak by accident.
 *
 * <p>{@code userId} is the key the role and removal routes take, which is why the membership row's own id is
 * not exposed — a client never needs it, and one fewer identifier in the contract is one fewer thing to
 * guess at.
 */
public record WorkspaceMemberResponse(UUID userId, String email, String displayName, String role) {

    static WorkspaceMemberResponse from(WorkspaceMemberSummary summary) {
        return new WorkspaceMemberResponse(
                summary.userId(), summary.email(), summary.displayName(), summary.role());
    }

}
