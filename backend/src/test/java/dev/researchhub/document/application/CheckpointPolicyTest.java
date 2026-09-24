package dev.researchhub.document.application;

import dev.researchhub.document.domain.DocumentVersionReason;
import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.time.Instant;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

/** When a save becomes a restore point. */
class CheckpointPolicyTest {

    private static final Instant NOW = Instant.parse("2026-09-24T10:00:00Z");
    private static final CheckpointPolicy POLICY = new CheckpointPolicy(Duration.ofMinutes(10));

    @Test
    void aManualSaveIsAlwaysAMilestone() {
        assertEquals(Optional.of(DocumentVersionReason.MANUAL_SAVE),
                POLICY.reasonFor(SaveKind.MANUAL, Optional.of(NOW.minusSeconds(1)), NOW),
                "even a second after the last one: the person asked for it");
        assertEquals(Optional.of(DocumentVersionReason.MANUAL_SAVE),
                POLICY.reasonFor(SaveKind.MANUAL, Optional.empty(), NOW));
    }

    @Test
    void anAutosaveSoonAfterTheLastSnapshotIsNotRecorded() {
        assertEquals(Optional.empty(),
                POLICY.reasonFor(SaveKind.AUTOSAVE, Optional.of(NOW.minus(Duration.ofMinutes(9))), NOW),
                "otherwise every pause in typing would leave a restore point");
    }

    @Test
    void anAutosaveOnceTheIntervalHasPassedIsACheckpoint() {
        assertEquals(Optional.of(DocumentVersionReason.AUTOSAVE_CHECKPOINT),
                POLICY.reasonFor(SaveKind.AUTOSAVE, Optional.of(NOW.minus(Duration.ofMinutes(10))), NOW),
                "exactly the interval counts");
        assertEquals(Optional.of(DocumentVersionReason.AUTOSAVE_CHECKPOINT),
                POLICY.reasonFor(SaveKind.AUTOSAVE, Optional.of(NOW.minus(Duration.ofHours(3))), NOW));
    }

    @Test
    void anAutosaveOfADocumentWithNoHistoryIsACheckpoint() {
        assertEquals(Optional.of(DocumentVersionReason.AUTOSAVE_CHECKPOINT),
                POLICY.reasonFor(SaveKind.AUTOSAVE, Optional.empty(), NOW),
                "a document from before history existed gets its first restore point");
    }

    @Test
    void aZeroIntervalCheckpointsEveryAutosave() {
        assertEquals(Optional.of(DocumentVersionReason.AUTOSAVE_CHECKPOINT),
                new CheckpointPolicy(Duration.ZERO).reasonFor(SaveKind.AUTOSAVE, Optional.of(NOW), NOW));
    }

    @Test
    void refusesANegativeOrMissingInterval() {
        assertThrows(IllegalArgumentException.class, () -> new CheckpointPolicy(Duration.ofSeconds(-1)));
        assertThrows(NullPointerException.class, () -> new CheckpointPolicy(null));
        assertEquals(Duration.ofMinutes(10), POLICY.autosaveInterval());
    }

}
