package dev.researchhub.workspace.api;

import dev.researchhub.shared.validation.EmailFormat;
import dev.researchhub.shared.validation.FieldLengths;
import dev.researchhub.shared.validation.Normalize;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

/**
 * Body of {@code POST /api/workspaces/{workspaceId}/members}.
 *
 * <p>{@code email} names somebody who has already registered. It is trimmed before validation, and the
 * server matches it case-insensitively against the normalized address, so the casing a person types does not
 * matter. Nothing is ever sent to it: an address with no account is a 404, not an invitation.
 *
 * <p>{@code role} accepts only {@code EDITOR} or {@code VIEWER}. Refusing {@code OWNER} here, as a field
 * error rather than deep in the service, gives the client a message pointing at the field it got wrong.
 * Ownership is granted through {@code PATCH .../members/{userId}} to somebody already in the workspace.
 *
 * <p>The pattern lists the role names as literals because {@code api} may not depend on
 * {@code workspace.domain}. Adding a role to {@code WorkspaceRole} therefore means revisiting this
 * constraint and {@code ck_workspace_members_role}, the same way widening {@code UserStatus} does.
 */
public record AddMemberRequest(
        @NotBlank
        @Email(regexp = EmailFormat.PATTERN)
        @Size(max = FieldLengths.EMAIL_MAX)
        String email,

        @NotBlank
        @Pattern(regexp = "EDITOR|VIEWER", message = "must be EDITOR or VIEWER")
        String role
) {

    public AddMemberRequest {
        email = Normalize.trim(email);
        role = Normalize.trim(role);
    }

}
