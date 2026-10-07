package dev.researchhub.source.application;

import dev.researchhub.source.domain.BibliographicMetadata;
import java.util.List;

/** Explicit public bibliographic contract. Empty fields are null; author order is significant. */
public record SourceBibliography(String title, List<String> authors, Integer publicationYear,
                                 String doi, String venue, String url, String citationKey) {
    public static SourceBibliography from(BibliographicMetadata metadata) {
        return new SourceBibliography(metadata.title(), metadata.authors(), metadata.publicationYear(),
                metadata.doi(), metadata.venue(), metadata.url(), metadata.citationKey());
    }

    public BibliographicMetadata toDomain() {
        return new BibliographicMetadata(title, authors, publicationYear, doi, venue, url, citationKey);
    }
}
