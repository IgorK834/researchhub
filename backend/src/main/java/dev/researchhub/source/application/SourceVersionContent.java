package dev.researchhub.source.application;

import java.io.InputStream;

/** Authorized exact-version bytes and safe metadata. */
public record SourceVersionContent(SourceVersionSummary version, InputStream content) {}
