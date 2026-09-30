package dev.researchhub.source.application;

import dev.researchhub.processing.application.SourceExtraction;
import java.util.UUID;

/** Canonical, workspace-authorized location for later citation APIs. Links are relative to the product origin. */
public record SourceLocation(UUID workspaceId, UUID sourceId, String unitId, Integer pageNumber,
                             long characterStart, long characterEnd, SourceExtraction.UnitLocation location,
                             String parserVersion, String processingVersion, String contentSha256,
                             String sourceUrl, String previewUrl) {}
