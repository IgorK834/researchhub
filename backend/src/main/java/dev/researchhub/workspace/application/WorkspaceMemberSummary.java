package dev.researchhub.workspace.application;

import java.util.UUID;

/**
 * One member of a workspace, as the other members may see them.
 *
 * <p>Four fields, and the absence of the rest is the point. There is no password hash — no type between
 * here and the database has one — and no {@code normalizedEmail}, which is an internal uniqueness key. There
 * is also no {@code status}: whether a colleague's account is disabled is between them and the system, not
 * something a workspace roster should announce.
 *
 * <p>{@code email} and {@code displayName} are shown to every member, including editors and viewers, because
 * knowing who else is in a workspace is part of collaborating in it. That is a deliberate disclosure within
 * the boundary, and it stops there: a non-member cannot reach this type, because the member list is behind
 * the same 404 as the workspace itself.
 *
 * <p>{@code role} is the enum name rather than {@code WorkspaceRole}, so {@code workspace.api} can render it
 * without importing {@code workspace.domain}.
 */
public record WorkspaceMemberSummary(UUID userId, String email, String displayName, String role) {
}
