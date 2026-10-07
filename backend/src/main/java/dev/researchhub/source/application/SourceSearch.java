package dev.researchhub.source.application;

import dev.researchhub.source.domain.SourceType;
import dev.researchhub.source.domain.SourceStatus;
import dev.researchhub.source.domain.SourceLabels;
import java.util.List;
import java.util.Locale;
import java.util.UUID;

/** Bounded AND filters; name/title matching is a literal case-insensitive substring. */
public record SourceSearch(String query, String type, UUID uploader, String status, String tag,
                           String collection, int page, int size) {
    public SourceSearch {
        query = query == null ? "" : query.strip().toLowerCase(Locale.ROOT);
        if (query.length() > 200) throw new IllegalArgumentException("Search text must be at most 200 characters");
        type = type == null || type.isBlank() ? "" : SourceType.valueOf(type).name();
        status = status == null || status.isBlank() ? "" : SourceStatus.valueOf(status).name();
        tag = label(tag);
        collection = label(collection);
        if (page < 0 || page > 1000000 || size < 1 || size > 100)
            throw new IllegalArgumentException("Page must be 0–1000000 and size must be 1–100");
    }

    private static String label(String value) {
        return value == null || value.isBlank() ? "" : SourceLabels.normalize(List.of(value)).getFirst();
    }
}
