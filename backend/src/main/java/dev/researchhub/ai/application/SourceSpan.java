package dev.researchhub.ai.application;

/** Half-open range in the original extraction, with an explicit extraction unit identity. */
public record SourceSpan(String unitId, long characterStart, long characterEnd) {}
