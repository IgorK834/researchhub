package dev.researchhub.ai.application;
import java.util.UUID;
import dev.researchhub.ai.application.AuthoringContracts.*;
public interface AuthoringStore {
    Suggestion save(Suggestion suggestion);
    Suggestion find(UUID workspaceId, UUID documentId, UUID id, boolean lock);
    void reject(UUID workspaceId, UUID id);
    void accept(UUID workspaceId, UUID id, UUID callerId, long revision, Accept command, String contentHash);
    String acceptedInput(UUID workspaceId, UUID id);
}
