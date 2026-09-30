package dev.researchhub.ai.application;

/** Character counts and offsets use Unicode code points, never Java UTF-16 indices. */
public record ChunkingConfig(String version, int maxCharacters, int overlapCharacters, int minCharacters) {
    public void validate() {
        if (!"hierarchical-char-1".equals(version) || maxCharacters < 32 || maxCharacters > 8000
                || overlapCharacters < 0 || overlapCharacters > maxCharacters / 2
                || minCharacters < 1 || minCharacters > maxCharacters - overlapCharacters) {
            throw new IllegalArgumentException("Invalid retrieval chunking configuration");
        }
    }
}
