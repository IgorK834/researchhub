package dev.researchhub.ai.application;

import dev.researchhub.ai.application.GenerationContracts.*;

/** Application port; cloud selection and provider protocol stay behind this boundary. */
public interface ModelProvider {
    Result generateStructured(Request request);
    Result generateStructured(ContextContracts.ContextualRequest request);
    ModelMetadata modelMetadata();
}
