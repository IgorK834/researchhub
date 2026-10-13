package dev.researchhub.source.application;

import java.util.Optional;

/** Outbound metadata port. Results are untrusted suggestions and are never source evidence. */
public interface BibliographicLookup {
    boolean available();
    Optional<SourceBibliography> lookup(String normalizedDoi);
}
