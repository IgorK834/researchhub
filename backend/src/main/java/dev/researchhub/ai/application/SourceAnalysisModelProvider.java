package dev.researchhub.ai.application;

public interface SourceAnalysisModelProvider {
    SourceAnalysisContracts.Result analyze(ContextContracts.ContextualRequest request);
}
