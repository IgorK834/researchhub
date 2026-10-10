package dev.researchhub.ai.application;

import java.time.Instant;
import dev.researchhub.document.application.CanvasTargets.*;
import java.util.UUID;

/** Canvas v1. Positions and lengths are UTF-16 code units, never code points or bytes. */
public final class CanvasContracts {
    private CanvasContracts() {}
    public record Capture(String schemaVersion, UUID clientRequestId, long revision, Long epoch,
                          Long sequence, String stateVector, Relative relative, Target target) {}
    public record Context(String schemaVersion, UUID contextId, UUID workspaceId, UUID documentId,
                          long revision, Long epoch, Long sequence, Snapshot snapshot, Instant createdAt) {}
}
