package dev.researchhub.document.application;

import dev.researchhub.document.infrastructure.DocumentRepository;
import dev.researchhub.document.infrastructure.PostgresDocumentProvenance;
import dev.researchhub.shared.error.*;
import dev.researchhub.user.application.UserLookupService;
import dev.researchhub.workspace.application.WorkspaceAuthorizationService;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.*;
import tools.jackson.databind.*;
import tools.jackson.databind.node.ObjectNode;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.*;
import java.util.*;

/** Operation history for stable blocks. This is recorded origin, never inferred authorship or span percentages. */
@Service
@Profile("local")
public class DocumentProvenance {
    public enum Category { HUMAN, AI_GENERATED, AI_REWRITTEN, IMPORTED, ANALYSIS_DERIVED }
    public record Operation(UUID id, UUID blockId, Category category, UUID actorUserId, String actorName,
            String operationType, UUID sourceOperationId, JsonNode metadata, long documentRevision, Instant createdAt) {}
    private final PostgresDocumentProvenance store;
    private final DocumentRepository documents;
    private final WorkspaceAuthorizationService authorization;
    private final UserLookupService users;
    private final ObjectMapper json;
    private final Clock clock;
    public DocumentProvenance(PostgresDocumentProvenance store, DocumentRepository documents,
            WorkspaceAuthorizationService authorization, UserLookupService users, ObjectMapper json, Clock clock) {
        this.store=store; this.documents=documents; this.authorization=authorization; this.users=users; this.json=json; this.clock=clock;
    }
    @Transactional(readOnly=true)
    public List<Operation> inspect(UUID workspace, UUID caller, UUID document, UUID block) {
        authorization.requireContentReader(workspace,caller);
        var current=documents.findByWorkspaceIdAndId(workspace,document).orElseThrow(() -> new ResourceNotFoundException("Document was not found"));
        if (!blocks(current.getContent()).containsKey(block)) throw new ResourceNotFoundException("Document block was not found");
        return store.history(workspace,document,block,200);
    }
    @Transactional(propagation=Propagation.MANDATORY)
    public void recordChanges(UUID workspace, UUID caller, UUID document, long revision, String content, String before) {
        var latest=store.latestHashes(workspace,document);
        var previous=before==null ? Map.<UUID,JsonNode>of() : blocks(before);
        String actor=actorName(caller);
        for (var entry:blocks(content).entrySet()) {
            var block=entry.getValue(); String hash=hash(block);
            if (hash.equals(latest.get(entry.getKey()))) continue;
            boolean analysis="analysisResult".equals(block.path("type").asString());
            var category=analysis ? Category.ANALYSIS_DERIVED : "IMPORTED".equals(block.path("attrs").path("originIntent").asString()) && (!latest.containsKey(entry.getKey()) || !block.path("attrs").path("importOperationId").equals(previous.getOrDefault(entry.getKey(),json.createObjectNode()).path("attrs").path("importOperationId"))) ? Category.IMPORTED : Category.HUMAN;
            var metadata=json.createObjectNode().put("blockType",block.path("type").asString());
            if (analysis) metadata.set("analysis",block.path("attrs").path("reference"));
            append(workspace,document,entry.getKey(),category,caller,actor,latest.containsKey(entry.getKey()) ? "EDITED" : category==Category.HUMAN ? "TRACKED" : "INSERTED",null,metadata,revision,hash);
        }
    }
    /** Trusted application boundary: called only after explicit, validated AI approval in the same transaction. */
    @Transactional(propagation=Propagation.MANDATORY)
    public void aiAccepted(UUID workspace, UUID caller, DocumentDetail saved, UUID sourceOperation, Category category,
            List<UUID> blockIds, JsonNode citations, JsonNode model, boolean editedByHuman) {
        if (!Set.of(Category.AI_GENERATED,Category.AI_REWRITTEN,Category.HUMAN).contains(category)) throw new IllegalArgumentException("Invalid AI origin category");
        var metadata=json.createObjectNode(); var evidence=metadata.putArray("citations");
        for (var citation:citations) {
            var reference=json.createObjectNode();
            for (String key:List.of("workspaceId","sourceId","sourceVersionId","chunkId","contentHash","processingVersion","pageStart","pageEnd","sectionTitle","title","spans"))
                if (citation.has(key)) reference.set(key,citation.path(key));
            evidence.add(reference);
        }
        var modelInfo=metadata.putObject("model");
        for (String key:List.of("provider","name","version")) if (model!=null && model.has(key)) modelInfo.set(key,model.path(key));
        metadata.put("editedBeforeAcceptance",editedByHuman);
        var blocks=blocks(saved.content());
        for (UUID block:blockIds) {
            var node=blocks.get(block);
            if (node==null) throw new ConflictException("The approved block is missing");
            append(workspace,saved.summary().id(),block,category,caller,actorName(caller),category==Category.HUMAN ? "CITATION_ADDED" : "AI_ACCEPTED",sourceOperation,metadata,saved.summary().revision(),hash(node));
        }
    }
    public List<UUID> anchoredBlocks(String content, String anchor) {
        return blocks(content).entrySet().stream().filter(e -> hasAnchor(e.getValue(),anchor)).map(Map.Entry::getKey).toList();
    }
    private static boolean hasAnchor(JsonNode node,String anchor) {
        for (var mark:node.path("marks")) if ("commentAnchor".equals(mark.path("type").asString()))
            for (var id:mark.path("attrs").path("ids")) if (anchor.equals(id.asString())) return true;
        for (var child:node.path("content")) if (hasAnchor(child,anchor)) return true;
        return false;
    }
    /** Reserved identities must be well formed and unique; clients cannot submit an AI classification. */
    public Map<UUID,JsonNode> blocks(String content) {
        var result=new LinkedHashMap<UUID,JsonNode>(); collect(json.readTree(content),result,0); return result;
    }
    private void collect(JsonNode node,Map<UUID,JsonNode> result,int depth) {
        if (depth>64) throw invalid();
        var id=node.path("attrs").path("blockId");
        if (!id.isMissingNode() && !id.isNull()) {
            if (!Set.of("paragraph","heading","codeBlock","analysisResult","figure").contains(node.path("type").asString())) throw invalid();
            UUID identity;
            try { identity=UUID.fromString(id.asString()); if (!identity.toString().equals(id.asString().toLowerCase(Locale.ROOT))) throw invalid(); }
            catch (IllegalArgumentException bad) { throw invalid(); }
            if (result.put(identity,node)!=null || result.size()>5000) throw invalid();
        }
        var imported=node.path("attrs").path("importOperationId");
        if (!imported.isMissingNode() && !imported.isNull()) {
            try { UUID.fromString(imported.asString()); } catch(IllegalArgumentException bad) { throw invalid(); }
        }
        var intent=node.path("attrs").path("originIntent");
        if (!intent.isMissingNode() && !intent.isNull() && !"IMPORTED".equals(intent.asString())) throw invalid();
        for (var child:node.path("content")) collect(child,result,depth+1);
    }
    private void append(UUID workspace,UUID document,UUID block,Category category,UUID actor,String name,String type,UUID source,JsonNode metadata,long revision,String hash) {
        store.append(workspace,document,new Operation(UUID.randomUUID(),block,category,actor,name,type,source,metadata,revision,clock.instant()),hash);
    }
    private String actorName(UUID actor) {
        return actor==null ? "System" : users.findAllByIds(List.of(actor)).stream().findFirst().map(u -> u.displayName()).orElse("Former member");
    }
    private String hash(JsonNode node) {
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(json.writeValueAsString(ordered(node)).getBytes(StandardCharsets.UTF_8))); }
        catch (java.security.NoSuchAlgorithmException impossible) { throw new IllegalStateException(impossible); }
    }
    private JsonNode ordered(JsonNode node) {
        if (node.isObject()) { ObjectNode result=json.createObjectNode(); node.properties().stream().sorted(Map.Entry.comparingByKey()).forEach(e -> result.set(e.getKey(),ordered(e.getValue()))); return result; }
        if (node.isArray()) { var result=json.createArrayNode(); node.forEach(n -> result.add(ordered(n))); return result; }
        return node;
    }
    private static ApiException invalid() { return new ApiException(ApiErrorCode.VALIDATION_FAILED,"Invalid or duplicate document block identity"); }
}
