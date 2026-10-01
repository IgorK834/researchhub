package dev.researchhub.processing.application;

import java.time.Duration;
import java.util.UUID;

/** Resolves a source by both workspace and source id before any internal worker request is built. */
public interface SourceIngestInputProvider {

    SourceIngestInput resolve(UUID workspaceId, UUID sourceId, UUID jobId, Duration accessTtl);
}
