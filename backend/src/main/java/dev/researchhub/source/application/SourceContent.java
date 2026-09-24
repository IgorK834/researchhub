package dev.researchhub.source.application;

import java.io.InputStream;

/** A source's metadata and an open stream of its bytes. The caller closes {@code content}. */
public record SourceContent(SourceSummary source, InputStream content) {
}
