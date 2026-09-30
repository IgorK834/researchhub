package dev.researchhub.ai.application;

import java.util.List;

/** No vendor SDK crosses the application boundary. */
public interface EmbeddingProvider {
    EmbeddingBatch embedDocuments(List<String> texts);
    EmbeddingBatch embedQuery(String text);
    EmbeddingModel modelMetadata();
}
