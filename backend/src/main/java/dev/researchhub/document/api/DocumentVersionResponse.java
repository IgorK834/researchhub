package dev.researchhub.document.api;

import dev.researchhub.document.application.DocumentVersionDetail;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.time.Instant;
import java.util.UUID;

/**
 * One version with its content: the summary's fields plus {@code contentFormat} and {@code content}, flattened
 * like {@link DocumentResponse}. {@code content} is the stored JSON object, never a string.
 */
public record DocumentVersionResponse(
        UUID id,
        long revision,
        String reason,
        UUID restoredFromVersionId,
        UUID createdBy,
        String name,
        String actorName,
        String stateSha256,
        Long collaborationEpoch,
        Long collaborationSequence,
        Instant createdAt,
        String contentFormat,
        JsonNode content
) {

    static DocumentVersionResponse from(DocumentVersionDetail detail, ObjectMapper objectMapper) {
        return new DocumentVersionResponse(
                detail.summary().id(),
                detail.summary().revision(),
                detail.summary().reason(),
                detail.summary().restoredFromVersionId(),
                detail.summary().createdBy(),
                detail.summary().name(),
                detail.summary().actorName(),
                detail.summary().stateSha256(),
                detail.summary().collaborationEpoch(),
                detail.summary().collaborationSequence(),
                detail.summary().createdAt(),
                detail.contentFormat(),
                objectMapper.readTree(detail.content()));
    }

}
