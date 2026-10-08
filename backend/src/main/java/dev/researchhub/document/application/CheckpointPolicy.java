package dev.researchhub.document.application;

import dev.researchhub.document.domain.DocumentVersionReason;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.time.Instant;
import java.util.Objects;
import java.util.Optional;

/**
 * Decides whether a save becomes a {@code document_versions} snapshot.
 *
 * <p>Not every save does. An autosaving editor saves every few seconds while somebody types, and a restore point
 * per save would be a row per sentence. So:
 *
 * <ul>
 *   <li>a {@link SaveKind#MANUAL} save is always a milestone,
 *   <li>an {@link SaveKind#AUTOSAVE} is one only when the newest snapshot is at least {@link #autosaveInterval()}
 *       old, or there is none — so a long autosaved session still leaves a restore point per interval.
 * </ul>
 *
 * <p>Configured by {@code researchhub.documents.history.autosave-checkpoint-interval} (default ten minutes).
 */
@Component
public class CheckpointPolicy {

    private final Duration autosaveInterval;

    public CheckpointPolicy(
            @Value("${researchhub.documents.history.autosave-checkpoint-interval:PT10M}") Duration autosaveInterval) {
        Objects.requireNonNull(autosaveInterval, "autosaveInterval must not be null");
        if (autosaveInterval.isNegative()) {
            throw new IllegalArgumentException("the autosave checkpoint interval must not be negative");
        }
        this.autosaveInterval = autosaveInterval;
    }

    public Duration autosaveInterval() {
        return autosaveInterval;
    }

    /**
     * Why this save should be snapshotted, or empty when it should not.
     *
     * @param newestSnapshotAt when the document's newest snapshot was taken, empty when it has none
     */
    public Optional<DocumentVersionReason> reasonFor(SaveKind kind, Optional<Instant> newestSnapshotAt,
                                                     Instant now) {
        return switch (kind) {
            case MANUAL -> Optional.of(DocumentVersionReason.MANUAL_SAVE);
            case AUTOSAVE -> newestSnapshotAt.isEmpty()
                    || !newestSnapshotAt.get().plus(autosaveInterval).isAfter(now)
                    ? Optional.of(DocumentVersionReason.AUTOSAVE_CHECKPOINT)
                    : Optional.empty();
        };
    }

}
