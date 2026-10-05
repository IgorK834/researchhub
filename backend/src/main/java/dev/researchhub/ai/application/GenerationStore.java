package dev.researchhub.ai.application;

import dev.researchhub.ai.application.GenerationContracts.*;
import dev.researchhub.shared.error.ApiErrorCode;
import java.util.*;

public interface GenerationStore {
    void begin(UUID workspaceId, UUID callerId, ContextContracts.ContextualRequest request, List<Citation> evidence);
    void beginComputed(UUID workspaceId,UUID callerId,ContextContracts.ContextualRequest request,List<Citation> evidence,
        List<dev.researchhub.analysis.application.AnalysisEvidenceService.Citation> computed);
    void succeed(UUID workspaceId, GeneratedResponse response);
    void fail(UUID workspaceId, UUID requestId, ApiErrorCode code);
    Optional<GeneratedResponse> findCompleted(UUID workspaceId, UUID requestId);
}
