package dev.researchhub.source.application;

import java.util.List;

/** Full replacement of mutable library labels only. */
public record SourceOrganization(String displayName, List<String> tags, List<String> collections) {}
