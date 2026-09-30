package dev.researchhub.ai.application;

import java.util.List;

public record EmbeddingBatch(EmbeddingModel metadata, List<List<Double>> vectors) {
    public EmbeddingBatch {
        if (metadata == null || vectors == null) throw new IllegalArgumentException("Missing embeddings");
        vectors = vectors.stream().map(vector -> {
            if (vector == null || vector.size() != metadata.dimension() || vector.stream().anyMatch(v -> v == null || !Double.isFinite(v))
                    || vector.stream().noneMatch(v -> v != 0)) throw new IllegalArgumentException("Invalid embedding vector");
            return List.copyOf(vector);
        }).toList();
    }
    public void requireCount(int expected) {
        if (vectors.size() != expected) throw new IllegalArgumentException("Embedding count differs from input count");
    }
}
