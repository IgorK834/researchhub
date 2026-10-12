package dev.researchhub.ai.application;

import dev.researchhub.ai.application.CanvasProposalContracts.*;
import dev.researchhub.ai.infrastructure.PostgresCanvasProposalStore;
import dev.researchhub.collaboration.application.CollaborationContracts.State;
import dev.researchhub.collaboration.application.CollaborationService;
import dev.researchhub.document.application.*;
import dev.researchhub.shared.error.*;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import tools.jackson.databind.ObjectMapper;

import java.util.*;

/**
 * Short database transactions surround the service bridge; no HTTP request holds a document lock.
 */
@Service
public class CanvasOperationService {
    private final PostgresCanvasProposalStore store;
    private final CanvasProposalService proposals;
    private final CanvasContextService contexts;
    private final DocumentService documents;
    @org.springframework.beans.factory.annotation.Autowired private dev.researchhub.ai.observability.CanvasWorkflowObservation observation=dev.researchhub.ai.observability.CanvasWorkflowObservation.none();
    private final DocumentProvenance provenance;
    private final CollaborationService collaboration;
    private final List<DocumentSnapshotState> states;
    private final ObjectMapper json;

    public CanvasOperationService(
            PostgresCanvasProposalStore store,
            CanvasProposalService proposals,
            CanvasContextService contexts,
            DocumentService documents,
            DocumentProvenance provenance,
            CollaborationService collaboration,
            List<DocumentSnapshotState> states,
            ObjectMapper json) {
        this.store = store;
        this.proposals = proposals;
        this.contexts = contexts;
        this.documents = documents;
        this.provenance = provenance;
        this.collaboration = collaboration;
        this.states = states;
        this.json = json;
    }

    @Transactional
    public Operation accept(
            UUID workspace, UUID document, UUID caller, UUID proposal, Accept request) {
        var doc = documents.lockForReview(workspace, caller, document);
        var p = store.find(workspace, document, proposal, true);
        if (!p.versionHash().equals(request.versionHash()))
            throw new ConflictException("Review the saved proposal version before accepting");
        proposals.authorize(p, caller);
        var context = contexts.find(workspace, document, caller, p.contextId());
        var op =
                new Operation(
                        request.clientOperationId(),
                        workspace,
                        document,
                        caller,
                        proposal,
                        "ACCEPT",
                        null,
                        context.epoch(),
                        null,
                        null);
        store.operation(
                op,
                RetrievalIdentity.hash(
                        json.writeValueAsString(
                                List.of(
                                        workspace, document, caller, proposal, "ACCEPT",
                                        request))));
        op = store.operation(op.id(), true);
        if (op.receipt() != null) return op;
        if (!"PENDING".equals(p.state()))
            throw new ConflictException("The proposal is no longer pending");
        if (op.epoch() == null) {
            if (states.stream().anyMatch(s -> s.requiresRealtime(document)))
                throw CanvasDocumentTarget.stale("TARGET_STALE");
            var patch = plan(op, p, doc);
            store.patch(op.id(), patch);
            commitLegacy(op, patch, doc);
        }
        return store.operation(op.id(), false);
    }

    @Transactional
    public Operation undo(
            UUID workspace, UUID document, UUID caller, UUID operation, Undo request) {
        var doc = documents.lockForReview(workspace, caller, document);
        var source = store.operation(operation, false);
        if (!source.workspaceId().equals(workspace) || !source.documentId().equals(document))
            throw new ResourceNotFoundException("Canvas operation was not found");
        if (!"ACCEPT".equals(source.kind()) || source.receipt() == null)
            throw new ConflictException("Choose an accepted AI operation to undo");
        var p = store.find(workspace, document, source.proposalId(), true);
        proposals.authorize(p, caller);
        var op =
                new Operation(
                        request.clientOperationId(),
                        workspace,
                        document,
                        caller,
                        p.id(),
                        "UNDO",
                        source.id(),
                        source.epoch(),
                        source.patch().inverse(),
                        null);
        store.operation(
                op,
                RetrievalIdentity.hash(
                        json.writeValueAsString(
                                List.of(workspace, document, caller, operation, "UNDO", request))));
        op = store.operation(op.id(), true);
        if (op.receipt() != null) return op;
        if (p.compensationId() != null)
            throw new ConflictException("This AI insertion was already undone");
        store.patch(op.id(), source.patch().inverse());
        if (op.epoch() == null) {
            if (states.stream().anyMatch(s -> s.requiresRealtime(document)))
                throw CanvasDocumentTarget.stale("TARGET_STALE");
            commitLegacy(op, source.patch().inverse(), doc);
        }
        return store.operation(op.id(), false);
    }

    public record Loaded(Operation operation, State state, CanvasEdit.Patch patch) {}

    @Transactional
    public Loaded load(UUID id) {
        var existing = store.operation(id, false);
        var doc =
                documents.lockForReview(
                        existing.workspaceId(), existing.callerId(), existing.documentId());
        var op = store.operation(id, true);
        var p = store.find(op.workspaceId(), op.documentId(), op.proposalId(), true);
        proposals.authorize(p, op.callerId());
        var canonical = collaboration.loadCanvas(op.workspaceId(), op.callerId(), op.documentId());
        if (op.epoch() == null || op.epoch() != canonical.epoch())
            throw CanvasDocumentTarget.stale("TARGET_STALE");
        if (op.receipt() != null) return new Loaded(op, canonical.state(), null);
        if ("UNDO".equals(op.kind()) && p.compensationId() != null)
            throw new ConflictException("This AI insertion was already undone");
        if ("ACCEPT".equals(op.kind()) && !"PENDING".equals(p.state()))
            throw new ConflictException("The proposal is no longer pending");
        var patch = "ACCEPT".equals(op.kind()) ? plan(op, p, doc) : op.patch();
        new CanvasEdit(json).apply(doc.content(), patch);
        store.patch(id, patch);
        return new Loaded(store.operation(id, false), canonical.state(), patch);
    }

    public record Commit(
            UUID operationId, long sequence, long epoch, String state, String content) {}

    public record Committed(Receipt receipt, State state) {}

    @Transactional
    public Committed commit(Commit request) {
        long started=System.nanoTime();
        var existing = store.operation(request.operationId(), false);
        var doc =
                documents.lockForReview(
                        existing.workspaceId(), existing.callerId(), existing.documentId());
        var op = store.operation(existing.id(), true);
        var p = store.find(op.workspaceId(), op.documentId(), op.proposalId(), true);
        proposals.authorize(p, op.callerId());
        if (op.receipt() != null)
            return new Committed(
                    op.receipt(),
                    collaboration
                            .loadCanvas(op.workspaceId(), op.callerId(), op.documentId())
                            .state());
        if ("UNDO".equals(op.kind()) && p.compensationId() != null)
            throw new ConflictException("This AI insertion was already undone");
        if (op.epoch() == null || request.epoch() != op.epoch() || op.patch() == null)
            throw CanvasDocumentTarget.stale("TARGET_STALE");
        if ("ACCEPT".equals(op.kind()) && !"PENDING".equals(p.state()))
            throw new ConflictException("The proposal is no longer pending");
        String expected = new CanvasEdit(json).apply(doc.content(), op.patch());
        if (!new CanvasEdit(json)
                .equivalent(json.readTree(expected), json.readTree(request.content())))
            throw new ConflictException("The candidate does not match the frozen AI operation");
        byte[] bytes;
        try {
            bytes = Base64.getDecoder().decode(request.state());
        } catch (RuntimeException bad) {
            throw new ApiException(ApiErrorCode.VALIDATION_FAILED, "Invalid snapshot encoding");
        }
        var saved =
                collaboration.commitCanvas(
                        op.workspaceId(),
                        op.callerId(),
                        op.documentId(),
                        request.epoch(),
                        request.sequence(),
                        op.id(),
                        bytes,
                        request.content());
        finish(op, p, saved, started);
        return new Committed(
                store.operation(op.id(), false).receipt(),
                collaboration.loadCanvas(op.workspaceId(), op.callerId(), op.documentId()).state());
    }

    private CanvasEdit.Patch plan(Operation op, Proposal p, DocumentDetail doc) {
        var target =
                contexts.resolve(op.workspaceId(), op.documentId(), op.callerId(), p.contextId())
                        .target();
        if(p.calculation()!=null)return new CanvasEdit(json).planBlocks(doc.content(),target,p.mode()==Mode.REPLACE_RANGE,p.calculation().blocks(),op.id());
        return new CanvasEdit(json)
                .plan(
                        doc.content(),
                        target,
                        p.mode() == Mode.REPLACE_RANGE,
                        p.paragraphs(),
                        json.valueToTree(p.citations()),
                        op.id());
    }

    private void commitLegacy(Operation op, CanvasEdit.Patch patch, DocumentDetail doc) {
        long started=System.nanoTime();
        String content = new CanvasEdit(json).apply(doc.content(), patch);
        var saved =
                documents.reviseFromAi(
                        op.workspaceId(),
                        op.callerId(),
                        op.documentId(),
                        new ReviseDocumentCommand(
                                doc.summary().title(),
                                content,
                                doc.summary().revision(),
                                SaveKind.MANUAL));
        finish(
                new Operation(
                        op.id(),
                        op.workspaceId(),
                        op.documentId(),
                        op.callerId(),
                        op.proposalId(),
                        op.kind(),
                        op.sourceOperationId(),
                        op.epoch(),
                        patch,
                        null),
                store.find(op.workspaceId(), op.documentId(), op.proposalId(), false),
                saved, started);
    }

    private void finish(Operation op, Proposal p, DocumentDetail saved, long start) {
        if ("ACCEPT".equals(op.kind())) {
            store.accepted(op.workspaceId(), p.id(), op.id());
            provenance.aiAccepted(
                    op.workspaceId(),
                    op.callerId(),
                    saved,
                    op.id(),
                    p.calculation()!=null ? DocumentProvenance.Category.ANALYSIS_DERIVED : p.mode() == Mode.INSERT_AT_ANCHOR
                            ? DocumentProvenance.Category.AI_GENERATED
                            : DocumentProvenance.Category.AI_REWRITTEN,
                    op.patch().generatedBlocks(),
                    json.valueToTree(p.citations()),
                    p.generation()==null ? json.valueToTree(p.calculation()) : json.valueToTree(p.generation().model()),
                    false);
        } else {
            var ids = new ArrayList<UUID>();
            for (var node : op.patch().after()) {
                var id = node.path("attrs").path("blockId").asString(null);
                if (id != null) ids.add(UUID.fromString(id));
            }
            provenance.canvasUndone(
                    op.workspaceId(), op.callerId(), saved, op.id(), op.sourceOperationId(), ids);
        }
        store.receipt(op.id(), new Receipt(op.id(), p.id(), op.kind(), saved.summary().revision()));
        observation.inserted(op,dev.researchhub.ai.observability.CanvasWorkflowObservation.elapsed(start));
    }
}
