package dev.researchhub.source.application;

/** Explicit review boundary: accepting or editing this suggestion requires the existing bibliography PUT. */
public record BibliographicSuggestion(String origin, SourceBibliography bibliography) {
    public BibliographicSuggestion {
        if (!"crossref".equals(origin) || bibliography == null) throw new IllegalArgumentException("Invalid bibliography suggestion");
    }
}
