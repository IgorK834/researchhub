package dev.researchhub.ai.application;

import java.util.List;
import java.util.UUID;

/** Retrieval/search v1. Page ranges are inclusive; source version is null until source versioning exists. */
public record RetrievalChunk(String chunkId, UUID sourceId, UUID workspaceId, UUID sourceVersionId,
                             int chunkIndex, String content, Integer pageStart, Integer pageEnd,
                             String sectionTitle, String contentHash, String processingVersion, List<SourceSpan> spans) {}
