package dev.researchhub.export.domain;

/** Closed, bundled citation-style allowlist. Style identifiers resolve from the pinned classpath artifact only. */
public enum CitationStyle {
    APA_7("apa"),
    IEEE("ieee");

    private final String cslId;

    CitationStyle(String cslId) { this.cslId = cslId; }

    public String cslId() { return cslId; }
}
