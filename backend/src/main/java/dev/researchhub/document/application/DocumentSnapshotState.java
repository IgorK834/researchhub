package dev.researchhub.document.application;

import java.util.Optional;
import java.util.UUID;

/** A transport's durable state, captured under the same document lock as the editor projection. */
public interface DocumentSnapshotState {
    record State(byte[] bytes, String sha256, long epoch, long sequence) {}
    Optional<State> snapshotState(UUID documentId);
    /** Retire existing replicas before exposing restored editor content. */
    void restoreState(UUID documentId);
}
