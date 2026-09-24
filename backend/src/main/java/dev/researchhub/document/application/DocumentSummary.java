package dev.researchhub.document.application;

import java.time.Instant;
import java.util.UUID;

/**
 * A document without its content: enough to list it, choose it, and know whether your copy is current.
 *
 * <p>The content is absent on purpose rather than for tidiness. A list of ten documents would otherwise be ten
 * megabytes of JSON the caller is about to discard, and every list response would grow with the length of the
 * prose inside it. {@link DocumentDetail} is what carries the text, one document at a time.
 *
 * <p>{@code revision} is included because a client needs it before it can save, and {@code archivedAt} because
 * an archived document is still readable by id and should be labelled as such.
 *
 * <p>{@code contentFormat} is the enum name rather than the enum, so {@code document.api} can render it
 * without importing {@code document.domain}.
 */
public record DocumentSummary(
        UUID id,
        String title,
        String contentFormat,
        long revision,
        Instant createdAt,
        Instant updatedAt,
        Instant archivedAt
) {

    /** True when this document has been archived. */
    public boolean isArchived() {
        return archivedAt != null;
    }

}
