package dev.researchhub.source.application;

import java.util.List;

/** Stable page contract, independent of Spring Data serialization defaults. */
public record SourceSearchPage(List<SourceSummary> items, long totalElements, int page, int size, boolean hasNext) {}
