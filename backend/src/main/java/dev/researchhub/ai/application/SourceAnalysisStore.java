package dev.researchhub.ai.application;

import java.util.UUID;
public interface SourceAnalysisStore {
    SourceAnalysisContracts.Analysis save(SourceAnalysisContracts.Analysis analysis);
    SourceAnalysisContracts.Analysis find(UUID workspaceId, UUID id);
}
