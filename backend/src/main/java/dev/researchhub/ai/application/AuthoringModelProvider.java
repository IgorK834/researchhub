package dev.researchhub.ai.application;

public interface AuthoringModelProvider {
    AuthoringContracts.Result author(ContextContracts.ContextualRequest request);
}
