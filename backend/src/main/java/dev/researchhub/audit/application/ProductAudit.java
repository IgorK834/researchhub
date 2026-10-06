package dev.researchhub.audit.application;

import dev.researchhub.audit.infrastructure.PostgresProductAudit;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.time.Clock;
import java.time.Instant;
import java.util.*;

/** Typed, append-only product history. Callers cannot submit arbitrary metadata or user text. */
@Service
@Profile("local")
@Transactional(propagation = Propagation.MANDATORY)
public class ProductAudit {
    public enum Type {
        WORKSPACE_CREATED, MEMBER_ADDED, MEMBER_ROLE_CHANGED, MEMBER_REMOVED,
        SOURCE_UPLOADED, SOURCE_REPROCESSED, DOCUMENT_CREATED, AI_EVIDENCE_REQUESTED,
        AI_SUGGESTION_ACCEPTED, ANALYSIS_EXECUTED, ANALYSIS_BLOCK_INSERTED
    }
    public record Event(UUID id, UUID workspaceId, UUID actorUserId, Type eventType,
                        String resourceType, UUID resourceId, Map<String, Object> metadata, Instant createdAt) {}
    private final PostgresProductAudit store;
    private final Clock clock;
    private final ObjectMapper json;
    public ProductAudit(PostgresProductAudit store, Clock clock, ObjectMapper json) {
        this.store = store; this.clock = clock; this.json = json;
    }
    public void workspaceCreated(UUID workspace, UUID actor) {
        append(workspace, actor, Type.WORKSPACE_CREATED, "WORKSPACE", workspace, Map.of());
    }
    public void memberAdded(UUID workspace, UUID actor, UUID member, String role) {
        append(workspace, actor, Type.MEMBER_ADDED, "MEMBER", member, Map.of("role", role(role)));
    }
    public void memberRoleChanged(UUID workspace, UUID actor, UUID member, String previous, String current) {
        append(workspace, actor, Type.MEMBER_ROLE_CHANGED, "MEMBER", member,
                Map.of("previousRole", role(previous), "role", role(current)));
    }
    public void memberRemoved(UUID workspace, UUID actor, UUID member) {
        append(workspace, actor, Type.MEMBER_REMOVED, "MEMBER", member, Map.of());
    }
    public void sourceUploaded(UUID workspace, UUID actor, UUID source, UUID version, long size) {
        append(workspace, actor, Type.SOURCE_UPLOADED, "SOURCE", source,
                Map.of("sourceVersionId", version, "sizeBytes", size));
    }
    public void sourceReprocessed(UUID workspace, UUID actor, UUID source, UUID version, UUID job) {
        append(workspace, actor, Type.SOURCE_REPROCESSED, "SOURCE", source,
                Map.of("sourceVersionId", version, "jobId", job));
    }
    public void evidenceRequested(UUID workspace, UUID actor, UUID suggestion, UUID document, UUID comment) {
        append(workspace, actor, Type.AI_EVIDENCE_REQUESTED, "COMMENT_AI_SUGGESTION", suggestion,
                Map.of("documentId", document, "commentId", comment));
    }
    public void aiSuggestionAccepted(UUID workspace, UUID actor, UUID suggestion, UUID document, long revision) {
        append(workspace, actor, Type.AI_SUGGESTION_ACCEPTED, "AI_SUGGESTION", suggestion,
                Map.of("documentId", document, "revision", revision));
    }
    public void commentCitationAccepted(UUID workspace, UUID actor, UUID suggestion, UUID document, long revision, String chunk) {
        if (chunk == null || !chunk.matches("[a-f0-9]{64}")) throw new IllegalArgumentException("Invalid audit citation identity");
        append(workspace, actor, Type.AI_SUGGESTION_ACCEPTED, "COMMENT_AI_SUGGESTION", suggestion,
                Map.of("documentId", document, "revision", revision, "chunkId", chunk));
    }
    public void analysisExecuted(UUID workspace, UUID actor, UUID execution, UUID analysis, boolean succeeded) {
        append(workspace, actor, Type.ANALYSIS_EXECUTED, "ANALYSIS_EXECUTION", execution,
                Map.of("analysisId", analysis, "status", succeeded ? "SUCCEEDED" : "FAILED"));
    }
    /** Both legacy saves and Yjs persistence use this boundary, after reference validation. */
    public void documentSaved(UUID workspace, UUID actor, UUID document, long revision, String before, String after) {
        if (before == null) append(workspace, actor, Type.DOCUMENT_CREATED, "DOCUMENT", document, Map.of("revision", revision));
        var previous = before == null ? Set.<Block>of() : blocks(before);
        for (var block : blocks(after)) if (!previous.contains(block)) {
            append(workspace, actor, Type.ANALYSIS_BLOCK_INSERTED, "DOCUMENT", document,
                    Map.of("revision", revision, "blockId", block.id(), "analysisId", block.analysis(), "executionId", block.execution()));
        }
    }
    private record Block(UUID id, UUID analysis, UUID execution, String output) {}
    private Set<Block> blocks(String content) {
        Set<Block> found = new HashSet<>(); collect(json.readTree(content), found); return found;
    }
    private static void collect(JsonNode node, Set<Block> found) {
        if ("analysisResult".equals(node.path("type").asString(""))) {
            var attrs = node.path("attrs"); var ref = attrs.path("reference");
            found.add(new Block(UUID.fromString(attrs.path("blockId").asString()),
                    UUID.fromString(ref.path("analysisId").asString()), UUID.fromString(ref.path("executionId").asString()), ref.path("outputId").asString()));
        }
        for (var child : node.path("content")) collect(child, found);
    }
    private void append(UUID workspace, UUID actor, Type type, String resource, UUID id, Map<String, Object> metadata) {
        store.append(new Event(UUID.randomUUID(), Objects.requireNonNull(workspace), actor, type, resource,
                Objects.requireNonNull(id), Map.copyOf(metadata), clock.instant()));
    }
    private static String role(String role) {
        if (!Set.of("OWNER", "EDITOR", "VIEWER").contains(role)) throw new IllegalArgumentException("Invalid audit role");
        return role;
    }
}
