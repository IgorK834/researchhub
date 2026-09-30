package dev.researchhub.source.application;

import java.util.List;
import java.util.UUID;

/** Public source-module boundary for authorizing selected-source retrieval. */
public interface SourceReadScope {
    void requireSources(UUID workspaceId, UUID callerId, List<UUID> sourceIds);
}
