package dev.researchhub.export.application;

import dev.researchhub.export.domain.Report.*;
import java.util.UUID;
import java.util.List;

/** Workspace-authorized module boundary; all returned values are frozen server-owned data. */
public interface ExportReferences {
    SourceReference source(UUID sourceId, UUID versionId, String processingVersion, String chunkId, String citedContentHash,
                           Integer pageStart, Integer pageEnd, String sectionTitle, List<Span> spans);
    List<Block> analysis(UUID analysisId, UUID executionId, String outputId, String renderMode, String caption);
}
