package dev.researchhub.ai.application;

import dev.researchhub.processing.application.SourceExtraction;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

/** Spring-owned persistence; readers reconstruct content from validated extraction ranges. */
public interface RetrievalStore {
    void save(UUID jobId, RetrievalChunkSet chunks, Instant now);
    boolean existsForJob(UUID workspaceId, UUID sourceId, UUID jobId);
    Optional<RetrievalChunkSet> find(UUID workspaceId, UUID sourceId, SourceExtraction extraction);
}
