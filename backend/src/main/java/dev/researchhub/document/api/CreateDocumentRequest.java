package dev.researchhub.document.api;

import dev.researchhub.shared.validation.FieldLengths;
import dev.researchhub.shared.validation.Normalize;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import tools.jackson.databind.JsonNode;

/**
 * Body of {@code POST /api/workspaces/{workspaceId}/documents}.
 *
 * <p>{@code content} is received as a parsed {@link JsonNode} rather than a string of JSON. That way the shape
 * check is a property of the value instead of a parse the endpoint has to perform, and a body that is not JSON
 * is refused by the message converter before validation runs.
 *
 * <p>{@code contentFormat} is optional and, if present, must be {@code PROSEMIRROR_JSON}. Accepting it at all
 * is a courtesy to a client that prefers to be explicit; the server decides the format either way, so there is
 * nothing a caller can choose here. It is a literal rather than a reference to the enum because {@code api}
 * may not depend on {@code document.domain}.
 *
 * <p>There is no author and no revision field. The author is the session user, and a new document starts at
 * revision 1 — neither is a client's to assert.
 */
public record CreateDocumentRequest(
        @NotBlank
        @Size(max = FieldLengths.TITLE_MAX)
        String title,

        @NotNull
        @JsonDocumentContent
        JsonNode content,

        @Pattern(regexp = "PROSEMIRROR_JSON", message = "must be PROSEMIRROR_JSON")
        String contentFormat
) {

    public CreateDocumentRequest {
        title = Normalize.trim(title);
        contentFormat = Normalize.trim(contentFormat);
    }

}
