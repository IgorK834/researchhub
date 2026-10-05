package dev.researchhub.collaboration.application;

import java.time.Instant;
import java.util.UUID;

public final class CollaborationContracts {
    private CollaborationContracts() {}
    public record Presence(UUID userId, String displayName, String colorId) {}
    public record Credential(String token, String room, String websocketUrl, Instant expiresAt, Presence user) {}
    public record Access(UUID workspaceId, UUID documentId, UUID userId, Instant expiresAt, Presence user) {
        public Access(UUID workspaceId, UUID documentId, UUID userId, Instant expiresAt) {
            this(workspaceId, documentId, userId, expiresAt, null);
        }
        public String room() { return "document:" + documentId; }
    }
    public record State(long sequence, String state, String title, String content, long revision, String savedAt, String stateSha256) {}
    public record Snapshot(String token, long sequence, String state, String title, String content, UUID snapshotId) {}
}
