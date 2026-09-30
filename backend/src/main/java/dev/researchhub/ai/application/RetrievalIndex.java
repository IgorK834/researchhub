package dev.researchhub.ai.application;

import java.util.List;
import java.util.UUID;

/** Mandatory workspace scope in every operation; rebuild atomically replaces a source version. */
public interface RetrievalIndex {
    void upsert(UUID jobId, RetrievalChunkSet chunks, EmbeddingBatch embeddings);
    void delete(UUID workspaceId, UUID sourceId);
    boolean existsForJob(UUID workspaceId, UUID sourceId, UUID jobId);
    boolean hasSearchableChunks(UUID workspaceId, List<UUID> sourceIds);
    List<RetrievalHit> search(String query, UUID workspaceId, List<UUID> sourceIds, int topK, EmbeddingBatch queryEmbedding);
}
