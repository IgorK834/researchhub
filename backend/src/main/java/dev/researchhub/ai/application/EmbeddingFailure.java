package dev.researchhub.ai.application;

/** Vendor-neutral safe failure; the processing module decides durable job retries. */
public class EmbeddingFailure extends RuntimeException {
    private final boolean retryable;

    public EmbeddingFailure(Throwable cause, boolean retryable) {
        super("Embedding could not be completed.", cause);
        this.retryable = retryable;
    }

    public boolean retryable() { return retryable; }
}
