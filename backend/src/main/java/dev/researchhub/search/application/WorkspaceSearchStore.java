package dev.researchhub.search.application;

import dev.researchhub.search.application.WorkspaceSearchContracts.Cursor;
import dev.researchhub.search.application.WorkspaceSearchContracts.Type;

import java.time.Instant;
import java.util.List;
import java.util.Set;
import java.util.UUID;

public interface WorkspaceSearchStore {
    record Hit(Type type, UUID id, String title, String content, String location,
               String sourceVersion, Instant updatedAt) {}

    List<Hit> search(UUID workspaceId, UUID callerId, String query, Set<Type> types, Cursor cursor, int fetchLimit);
}
