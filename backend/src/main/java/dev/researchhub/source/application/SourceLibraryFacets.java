package dev.researchhub.source.application;

import java.util.List;
import java.util.Map;
import java.util.UUID;

/** Workspace totals and available labels; unaffected by the current search page. */
public record SourceLibraryFacets(long total, long ready, Map<String, Long> types,
                                  List<UUID> uploaders, List<String> tags, List<String> collections) {}
