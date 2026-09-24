package dev.researchhub.document.api;

import dev.researchhub.document.application.DocumentSummary;

import java.time.Instant;
import java.util.UUID;

/**
 * A document in a list: everything except its text.
 *
 * <p>Omitting {@code content} is the contract, not an optimization detail a future change may reverse. A list
 * response must not grow with the length of the prose inside the workspace, and a client rendering titles has
 * no use for a megabyte of JSON per row. {@link DocumentResponse} carries the text, one document at a time.
 *
 * <p>{@code revision} is here because a client needs it before it can save, and {@code archivedAt} so an
 * archived document opened by id can be labelled as one.
 */
public record DocumentSummaryResponse(
        UUID id,
        String title,
        String contentFormat,
        long revision,
        Instant createdAt,
        Instant updatedAt,
        Instant archivedAt
) {

    static DocumentSummaryResponse from(DocumentSummary summary) {
        return new DocumentSummaryResponse(
                summary.id(),
                summary.title(),
                summary.contentFormat(),
                summary.revision(),
                summary.createdAt(),
                summary.updatedAt(),
                summary.archivedAt());
    }

}
