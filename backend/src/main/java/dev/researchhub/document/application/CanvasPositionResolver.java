package dev.researchhub.document.application;

import dev.researchhub.document.application.CanvasTargets.*;

/** Resolves untrusted relative positions exclusively against the server's frozen, verified snapshot. */
public interface CanvasPositionResolver {
    Resolution pin(DocumentSnapshotState.State state, Target target);
    Resolution resolve(DocumentSnapshotState.State state, Relative relative, String stateVector);
}
