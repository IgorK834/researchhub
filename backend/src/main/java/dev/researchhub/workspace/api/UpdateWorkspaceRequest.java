package dev.researchhub.workspace.api;

import dev.researchhub.shared.validation.FieldLengths;
import dev.researchhub.shared.validation.Normalize;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * Body of {@code PATCH /api/workspaces/{workspaceId}}.
 *
 * <p>Validated exactly like {@code CreateWorkspaceRequest}: both fields are trimmed in the compact
 * constructor before Bean Validation runs, the name is required and capped at
 * {@link FieldLengths#NAME_MAX}, and the description is optional and capped at
 * {@link FieldLengths#DESCRIPTION_MAX}. One rule set for creating and editing means the two cannot drift.
 *
 * <p><strong>This replaces the metadata; it does not merge it.</strong> Both fields are applied, so a
 * body carrying only a name clears the description. That is a deliberate choice over per-field patching:
 * in JSON an absent field and an explicit {@code null} both arrive here as {@code null}, so "leave the
 * description alone" and "remove the description" would be indistinguishable, and the endpoint would have
 * to guess. Sending the full metadata is unambiguous, and it is what an edit form — which is populated
 * from the current values — sends anyway.
 *
 * <p>There is no role, owner, or archival field. Ownership comes from the session, and archiving has its
 * own route precisely so it cannot happen as a side effect of an edit.
 */
public record UpdateWorkspaceRequest(
        @NotBlank
        @Size(max = FieldLengths.NAME_MAX)
        String name,

        @Size(max = FieldLengths.DESCRIPTION_MAX)
        String description
) {

    public UpdateWorkspaceRequest {
        name = Normalize.trim(name);
        description = Normalize.trim(description);
    }

}
