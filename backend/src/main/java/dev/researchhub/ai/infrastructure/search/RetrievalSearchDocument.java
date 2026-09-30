package dev.researchhub.ai.infrastructure.search;

import dev.researchhub.ai.application.RetrievalChunk;
import dev.researchhub.ai.application.SourceSpan;
import java.util.List;
import java.util.UUID;

/** Search v1 projection. Same explicit schema as Java/Python chunks; no search infrastructure provisioned here. */
public record RetrievalSearchDocument(String chunkId, UUID sourceId, UUID workspaceId, UUID sourceVersionId,
                                     int chunkIndex, String content, Integer pageStart, Integer pageEnd,
                                     String sectionTitle, String contentHash, String processingVersion, List<SourceSpan> spans) {
    public static RetrievalSearchDocument from(RetrievalChunk chunk) {
        if (chunk.workspaceId() == null || chunk.processingVersion() == null) throw new IllegalArgumentException("Search requires workspace/version scope");
        return new RetrievalSearchDocument(chunk.chunkId(), chunk.sourceId(), chunk.workspaceId(), chunk.sourceVersionId(),
                chunk.chunkIndex(), chunk.content(), chunk.pageStart(), chunk.pageEnd(), chunk.sectionTitle(), chunk.contentHash(), chunk.processingVersion(), chunk.spans());
    }
}
