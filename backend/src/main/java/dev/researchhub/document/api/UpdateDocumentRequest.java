package dev.researchhub.document.api;

import dev.researchhub.document.application.SaveKind;
import dev.researchhub.shared.validation.FieldLengths;
import dev.researchhub.shared.validation.Normalize;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;
import tools.jackson.databind.JsonNode;

/**
 * Body of {@code PATCH /api/workspaces/{workspaceId}/documents/{documentId}}.
 *
 * <p>{@code revision} is <strong>required</strong>, which is the whole point of the endpoint. It is the revision
 * the editor last saw, and the server refuses the save if the stored document has moved on. A {@link Long}
 * rather than a {@code long} so an omitted field is a missing value that {@code @NotNull} reports as a 400,
 * instead of defaulting to {@code 0} and being reported as a conflict — "you forgot to send it" and "somebody
 * else saved first" are different problems and should not share an answer.
 *
 * <p>{@code saveKind} is optional and says who decided to save: {@code MANUAL} (the default, so a client that
 * does not send it is treated as a person pressing save) or {@code AUTOSAVE}. It changes nothing about whether the
 * save succeeds. It decides only whether the save becomes a restore point in the document's history — a manual
 * save always does, an autosave only when the newest one has aged past the checkpoint interval. An unknown value
 * is {@code 400 MALFORMED_REQUEST}.
 *
 * <p>Title and content are both replaced. There is no partial patch, for the same reason the workspace metadata
 * endpoint has none: in JSON an absent field and an explicit {@code null} arrive identically, so a merge would
 * have to guess. An editor holds both values anyway.
 */
public record UpdateDocumentRequest(
        @NotBlank
        @Size(max = FieldLengths.TITLE_MAX)
        String title,

        @NotNull
        @JsonDocumentContent
        JsonNode content,

        @NotNull
        @Positive
        Long revision,

        SaveKind saveKind
) {

    public UpdateDocumentRequest {
        title = Normalize.trim(title);
        saveKind = saveKind == null ? SaveKind.MANUAL : saveKind;
    }

}
