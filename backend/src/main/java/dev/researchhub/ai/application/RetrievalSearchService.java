package dev.researchhub.ai.application;

import dev.researchhub.workspace.application.WorkspaceAuthorizationService;
import dev.researchhub.source.application.SourceReadScope;
import dev.researchhub.shared.error.*;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Service;
import java.util.List;
import java.util.UUID;

@Service
@Profile("local")
public class RetrievalSearchService {
    private final WorkspaceAuthorizationService authorization;
    private final SourceReadScope sources;
    private final EmbeddingProvider embeddings;
    private final RetrievalIndex index;
    public RetrievalSearchService(WorkspaceAuthorizationService authorization, SourceReadScope sources, EmbeddingProvider embeddings, RetrievalIndex index) {
        this.authorization = authorization; this.sources = sources; this.embeddings = embeddings; this.index = index;
    }
    public List<RetrievalHit> search(String query, UUID workspaceId, List<UUID> sourceIds, int topK, UUID callerId) {
        authorization.requireContentReader(workspaceId, callerId);
        if (query == null || query.isBlank() || query.length() > 2000 || topK < 1 || topK > 50 || (sourceIds != null && sourceIds.size() > 100))
            throw new ApiException(ApiErrorCode.VALIDATION_FAILED, "Invalid retrieval query or limits");
        if (sourceIds != null) sources.requireSources(workspaceId, callerId, sourceIds);
        if (sourceIds != null && sourceIds.isEmpty()) return List.of();
        if (!index.hasSearchableChunks(workspaceId, sourceIds)) return List.of();
        var embedding = embeddings.embedQuery(query);
        embedding.requireCount(1);
        return index.search(query, workspaceId, sourceIds, topK, embedding);
    }
}
