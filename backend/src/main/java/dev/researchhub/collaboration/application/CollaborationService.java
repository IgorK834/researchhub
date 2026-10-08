package dev.researchhub.collaboration.application;

import dev.researchhub.collaboration.application.CollaborationContracts.*;
import dev.researchhub.collaboration.infrastructure.CollaborationProperties;
import dev.researchhub.collaboration.infrastructure.PostgresCollaborationStore;
import dev.researchhub.document.application.DocumentService;
import dev.researchhub.user.application.UserLookupService;
import java.util.List;
import dev.researchhub.document.application.DocumentDetail;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import dev.researchhub.shared.error.*;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Clock;
import java.util.Base64;
import java.util.HexFormat;
import java.util.UUID;

@Service
public class CollaborationService {
    private static final Logger log = LoggerFactory.getLogger(CollaborationService.class);
    private final DocumentService documents;
    private final UserLookupService users;
    private final PostgresCollaborationStore store;
    private final CollaborationProperties properties;
    private final Clock clock;
    private final ObjectMapper json;
    private final SecureRandom random = new SecureRandom();
    public CollaborationService(DocumentService documents, PostgresCollaborationStore store,
                                CollaborationProperties properties, Clock clock, ObjectMapper json, UserLookupService users) {
        this.users = users; this.documents = documents; this.store = store; this.properties = properties; this.clock = clock; this.json = json;
    }
    @Transactional
    public Credential issue(UUID workspaceId, UUID userId, UUID documentId) {
        requireEnabled();
        documents.lockForCollaboration(workspaceId, userId, documentId);
        byte[] bytes = new byte[32]; random.nextBytes(bytes);
        String token = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
        Access access = new Access(workspaceId, documentId, userId, clock.instant().plus(properties.getTokenTtl()),null,store.state(documentId).map(PostgresCollaborationStore.StoredSnapshot::epoch).orElse(0L));
        store.credential(hash(token), access, clock.instant());
        return new Credential(token, access.room(), properties.getWebsocketUrl(), access.expiresAt(), presence(userId),access.epoch());
    }
    @Transactional
    public Access authorize(String token, String room) {
        requireEnabled();
        if (token == null || !token.matches("[A-Za-z0-9_-]{43}")) throw new ForbiddenException("Collaboration access denied");
        Access access = store.access(hash(token), clock.instant());
        if (!access.room().equals(room)) throw new ForbiddenException("Collaboration access denied");
        documents.lockForCollaboration(access.workspaceId(), access.userId(), access.documentId());
        if (store.state(access.documentId()).map(PostgresCollaborationStore.StoredSnapshot::epoch).orElse(0L)!=access.epoch())
            throw new ApiException(ApiErrorCode.COLLABORATION_STATE_REPLACED,"A snapshot was restored; load the new document state");
        return new Access(access.workspaceId(), access.documentId(), access.userId(), access.expiresAt(), presence(access.userId()),access.epoch());
    }
    // Resolve only a user already authorized by the document module. No email crosses this boundary.
    private Presence presence(UUID userId) {
        var user = users.findAllByIds(List.of(userId)).stream()
                .filter(account -> "ACTIVE".equals(account.status())).findFirst()
                .orElseThrow(() -> new ForbiddenException("Collaboration access denied"));
        // Match the existing avatar FNV-1a palette, stable across documents and reconnects.
        int hash = 0x811c9dc5;
        for (char character : userId.toString().toCharArray()) hash = (hash ^ character) * 0x01000193;
        var colors = List.of("blue", "coral", "lavender", "mint", "yellow");
        return new Presence(userId, user.displayName(), colors.get((int) (Integer.toUnsignedLong(hash) % colors.size())));
    }
    @Transactional
    public State load(String token, String room) {
        Access access = authorize(token, room);
        var doc = documents.lockForCollaboration(access.workspaceId(), access.userId(), access.documentId());
        store.activate(access.documentId());
        var stored = store.state(access.documentId()).orElseThrow();
        String stateHash = verifyHash(access.documentId(), stored);
        return stateOf(stored.sequence(), stored.state() == null ? null : Base64.getEncoder().encodeToString(stored.state()), doc, stateHash);
    }
    @Transactional
    public State save(String room, Snapshot request) {
        Access access = authorize(request.token(), room);
        byte[] state;
        try {
            state = Base64.getDecoder().decode(request.state());
            if (state.length == 0 || state.length > 4_000_000 || request.sequence() < 0 || request.snapshotId() == null
                    || !"doc".equals(json.readTree(request.content()).path("type").asText())) throw new IllegalArgumentException();
        } catch (RuntimeException invalid) {
            throw new ApiException(ApiErrorCode.VALIDATION_FAILED, "Invalid collaboration snapshot");
        }
        var doc = documents.lockForCollaboration(access.workspaceId(), access.userId(), access.documentId());
        var stored = store.state(access.documentId()).orElseThrow(() -> new ConflictException("Room has not been initialized"));
        String stateHash = hashBytes(state);
        // A lost HTTP response may replay the immediately preceding commit. It must be the exact same snapshot.
        if (request.snapshotId().equals(stored.snapshotId())) {
            verifyHash(access.documentId(), stored);
            if (stored.sequence() != request.sequence() + 1 || !stateHash.equals(stored.stateSha256())
                    || !doc.summary().title().equals(request.title()) || !json.readTree(doc.content()).equals(json.readTree(request.content()))) {
                throw new ConflictException("Snapshot identity was reused for different content");
            }
            return stateOf(stored.sequence(), null, doc, stateHash);
        }
        store.save(access.documentId(), request.sequence(), state, request.snapshotId(), stateHash);
        var saved = documents.persistCollaboration(access.workspaceId(), access.userId(), access.documentId(),
                request.title(), request.content(), doc.summary().revision());
        log.info("event=collaboration.snapshot.committed documentId={} sequence={} revision={}", access.documentId(), request.sequence() + 1, saved.summary().revision());
        return stateOf(request.sequence() + 1, null, saved, stateHash);
    }
    private String verifyHash(UUID documentId, PostgresCollaborationStore.StoredSnapshot stored) {
        if (stored.state() == null) {
            if (stored.sequence() != 0) throw new ConflictException("Collaboration snapshot is missing");
            return null;
        }
        String hash = hashBytes(stored.state());
        if (stored.stateSha256() == null) store.recordHash(documentId, hash);
        else if (!hash.equals(stored.stateSha256())) {
            log.error("event=collaboration.snapshot.corrupt documentId={} sequence={}", documentId, stored.sequence());
            throw new ConflictException("Collaboration snapshot integrity check failed");
        }
        return hash;
    }
    private static State stateOf(long sequence, String binary, DocumentDetail document, String hash) {
        return new State(sequence, binary, document.summary().title(), document.content(), document.summary().revision(),
                document.summary().updatedAt().toString(), hash);
    }
    @Transactional
    public DocumentDetail checkpoint(UUID workspaceId, UUID userId, UUID documentId) {
        requireEnabled();
        return documents.checkpointCollaboration(workspaceId, userId, documentId);
    }
    private void requireEnabled() {
        if (!properties.isEnabled()) throw new ConflictException("Realtime collaboration is disabled");
    }
    private static String hash(String token) {
        return hashBytes(token.getBytes(StandardCharsets.US_ASCII));
    }
    private static String hashBytes(byte[] bytes) {
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes)); }
        catch (java.security.NoSuchAlgorithmException impossible) { throw new IllegalStateException(impossible); }
    }

}
