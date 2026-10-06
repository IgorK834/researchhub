package dev.researchhub.comment.application;

import dev.researchhub.ai.application.AuthoringContracts.Category;
import dev.researchhub.audit.application.ProductAudit;
import dev.researchhub.comment.application.CommentEvidenceContracts.Suggestion;
import dev.researchhub.comment.infrastructure.PostgresCommentEvidence;
import dev.researchhub.document.application.DocumentService;
import dev.researchhub.shared.error.*;
import dev.researchhub.workspace.application.WorkspaceAuthorizationService;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import java.time.Clock;
import java.util.UUID;

/** Short commit boundary: lock, reauthorize, check anchor, append. Never called during inference. */
@Service
@Profile("local")
public class CommentEvidenceWriter {
    private final DocumentService documents;
    private final CommentService comments;
    private final CommentAnchors anchors;
    private final PostgresCommentEvidence store;
    private final WorkspaceAuthorizationService authorization;
    private final ProductAudit audit;
    private final ObjectMapper json;
    private final Clock clock;
    private final dev.researchhub.document.application.DocumentProvenance provenance;
    public CommentEvidenceWriter(DocumentService documents, CommentService comments, CommentAnchors anchors,
            PostgresCommentEvidence store, WorkspaceAuthorizationService authorization, ProductAudit audit, ObjectMapper json, Clock clock, dev.researchhub.document.application.DocumentProvenance provenance) {
        this.documents=documents; this.comments=comments; this.anchors=anchors; this.store=store;
        this.authorization=authorization; this.audit=audit; this.json=json; this.clock=clock; this.provenance=provenance;
    }
    @Transactional
    public void publish(UUID workspace, UUID document, UUID caller, Suggestion suggestion) {
        authorization.requireAiContributor(workspace,caller);
        var saved=documents.lockForReview(workspace,caller,document);
        var comment=comments.thread(workspace,caller,document,suggestion.commentId()).comment();
        var existing=store.find(workspace,document,comment.id(),suggestion.id()).orElse(null);
        if (existing!=null) {
            if (!existing.requestedBy().equals(caller)) throw new ConflictException("This AI request id is already in use");
            return;
        }
        if (!"OPEN".equals(comment.status())) throw new ConflictException("The thread was resolved during research assistance. Reopen it to request evidence.");
        if (!anchors.claim(saved.content(),comment.anchor().id()).equals(suggestion.claim()))
            throw new ConflictException("The highlighted claim changed during research assistance. Request evidence again.");
        store.append(workspace,document,suggestion);
        audit.evidenceRequested(workspace,caller,suggestion.id(),document,comment.id());
    }
    /** The editor inserts a citation through its normal save/Yjs flow. This confirms saved provenance only. */
    @Transactional
    public CommentContracts.Comment accept(UUID workspace, UUID document, UUID caller, UUID comment, UUID id, String chunk) {
        authorization.requireAiContributor(workspace,caller);
        var saved=documents.lockForReview(workspace,caller,document);
        var thread=comments.thread(workspace,caller,document,comment).comment();
        var suggestion=store.find(workspace,document,comment,id).orElseThrow(() -> new ResourceNotFoundException("AI suggestion was not found"));
        var candidate=suggestion.evidence().candidates().stream()
                .filter(c -> c.citation().chunkId().equals(chunk) && c.category()!=Category.insufficient).findFirst()
                .orElseThrow(() -> new ApiException(ApiErrorCode.VALIDATION_FAILED,"Choose an available evidence candidate"));
        // A lost-response retry remains safe after a peer deletes/revises the passage or citation.
        if (store.accepted(id,chunk)) return thread;
        if (!anchors.claim(saved.content(),thread.anchor().id()).equals(suggestion.claim()))
            throw new ConflictException("The highlighted claim changed. Request fresh evidence before citing.");
        if (!contains(json.readTree(saved.content()),json.readTree(json.writeValueAsString(candidate.citation()))))
            throw new ConflictException("Save the inserted citation before confirming this suggestion");
        if (store.accept(id,chunk,caller,saved.summary().revision(),clock.instant())) {
            provenance.aiAccepted(workspace,caller,saved,id,dev.researchhub.document.application.DocumentProvenance.Category.HUMAN,
                    provenance.anchoredBlocks(saved.content(),thread.anchor().id().toString()),json.valueToTree(java.util.List.of(candidate.citation())),json.valueToTree(suggestion.evidence().generation().model()),false);
            audit.commentCitationAccepted(workspace,caller,id,document,saved.summary().revision(),chunk);
        }
        return comments.thread(workspace,caller,document,comment).comment();
    }
    private static boolean contains(JsonNode node, JsonNode expected) {
        if ("researchCitation".equals(node.path("type").asString(""))) {
            var citation=node.path("attrs").path("citation");
            if (expected.properties().stream().allMatch(e -> e.getValue().equals(citation.path(e.getKey())))) return true;
        }
        for (var child:node.path("content")) if (contains(child,expected)) return true;
        return false;
    }
}
