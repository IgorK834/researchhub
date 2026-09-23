package dev.researchhub.workspace.api;

import dev.researchhub.shared.validation.FieldLengths;
import dev.researchhub.shared.validation.Normalize;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * Body of {@code POST /api/workspaces}.
 *
 * <p>There is no creator field. The owner is the authenticated caller, taken from the session by
 * {@link WorkspaceController}; accepting one here would let a client create a workspace owned by
 * somebody else.
 *
 * <p>Both fields are trimmed in the compact constructor, before Bean Validation runs, so a
 * whitespace-only name is rejected as blank rather than stored as invisible content
 * (docs/development/validation.md). The limits come from {@code shared.validation} so the DTO, the
 * domain, and the column agree on one number.
 *
 * <p>{@code description} is optional and may be blank. Only {@code name} is required, because a
 * workspace with no name cannot be told apart in a list. These constraints exist for a fast 400; the
 * same rules are enforced again by {@code Workspace}, which is what protects callers that never pass
 * through this record.
 */
public record CreateWorkspaceRequest(
        @NotBlank
        @Size(max = FieldLengths.NAME_MAX)
        String name,

        @Size(max = FieldLengths.DESCRIPTION_MAX)
        String description
) {

    public CreateWorkspaceRequest {
        name = Normalize.trim(name);
        description = Normalize.trim(description);
    }

}
