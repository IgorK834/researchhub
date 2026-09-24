package dev.researchhub.document.api;

import dev.researchhub.document.application.DocumentDetail;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.time.Instant;
import java.util.UUID;

/**
 * One document with its content.
 *
 * <p>{@code content} is a {@link JsonNode} so it serializes as the JSON object it is. Returning the stored text
 * as a {@link String} would emit a quoted, escaped string, and every client would have to parse the body twice
 * to get at the document.
 *
 * <p>The stored text is parsed once here rather than anywhere deeper. The backend does not interpret document
 * content — it stores and returns it — so this is the only point that needs it as a tree, and
 * {@code document.application} stays free of a JSON dependency.
 *
 * <p>Flattened rather than nesting the summary, because a client asking for one document wants one object, not
 * a wrapper. The fields are the summary's plus {@code content}, and
 * {@link #from(DocumentDetail, ObjectMapper)} is the one place that has to stay in step.
 */
public record DocumentResponse(
        UUID id,
        String title,
        String contentFormat,
        long revision,
        Instant createdAt,
        Instant updatedAt,
        Instant archivedAt,
        JsonNode content
) {

    static DocumentResponse from(DocumentDetail detail, ObjectMapper objectMapper) {
        return new DocumentResponse(
                detail.summary().id(),
                detail.summary().title(),
                detail.summary().contentFormat(),
                detail.summary().revision(),
                detail.summary().createdAt(),
                detail.summary().updatedAt(),
                detail.summary().archivedAt(),
                objectMapper.readTree(detail.content()));
    }

}
