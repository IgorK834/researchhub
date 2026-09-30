package dev.researchhub.ai.application;

public record RetrievalHit(RetrievalChunk chunk, double score, double vectorSimilarity, double lexicalScore,
                           EmbeddingModel model) {}
