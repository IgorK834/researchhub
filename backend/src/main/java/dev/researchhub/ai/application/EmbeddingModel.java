package dev.researchhub.ai.application;

/** Immutable vector-space identity; changing any field requires a rebuild. */
public record EmbeddingModel(String provider, String name, String version, int dimension) {
    public EmbeddingModel {
        if (invalid(provider) || invalid(name) || invalid(version) || dimension < 1 || dimension > 4096)
            throw new IllegalArgumentException("Invalid embedding model metadata");
    }
    private static boolean invalid(String value) { return value == null || value.isBlank() || value.length() > 128; }
    public String indexId() { return RetrievalIdentity.digest(provider, name, version, dimension); }
}
