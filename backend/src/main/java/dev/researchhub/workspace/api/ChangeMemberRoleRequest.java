package dev.researchhub.workspace.api;

import dev.researchhub.shared.validation.Normalize;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;

/**
 * Body of {@code PATCH /api/workspaces/{workspaceId}/members/{userId}}.
 *
 * <p>All three roles are accepted here, unlike {@link AddMemberRequest}: promoting an existing member to
 * {@code OWNER} is how ownership is shared or handed over. The workspace keeps at least one owner, so the
 * demotion that completes a transfer is only possible once somebody else holds the role — that rule lives in
 * {@code WorkspaceMembers} and answers {@code 409}.
 *
 * <p>The member is identified by the path, not the body. There is no user id or email field to disagree with
 * the URL.
 */
public record ChangeMemberRoleRequest(
        @NotBlank
        @Pattern(regexp = "OWNER|EDITOR|VIEWER", message = "must be OWNER, EDITOR or VIEWER")
        String role
) {

    public ChangeMemberRoleRequest {
        role = Normalize.trim(role);
    }

}
