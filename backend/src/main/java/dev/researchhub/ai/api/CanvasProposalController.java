package dev.researchhub.ai.api;

import dev.researchhub.ai.application.*;
import dev.researchhub.ai.application.CanvasProposalContracts.*;
import dev.researchhub.auth.application.CurrentUserResolver;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.UUID;

@RestController
@RequestMapping("/api/workspaces/{workspaceId}/documents/{documentId}/ai")
public class CanvasProposalController {
    private final CanvasProposalService proposals;
    private final CanvasOperationService operations;
    private final CurrentUserResolver users;
    private final CanvasOperationBridge bridge;
    @org.springframework.beans.factory.annotation.Autowired private CalculationProposalService calculations;

    public CanvasProposalController(
            CanvasProposalService proposals,
            CanvasOperationService operations,
            CurrentUserResolver users,
            CanvasOperationBridge bridge) {
        this.proposals = proposals;
        this.operations = operations;
        this.users = users;
        this.bridge = bridge;
    }

    @GetMapping("/proposals/{id}")
    public ResponseEntity<Proposal> find(
            @PathVariable UUID workspaceId, @PathVariable UUID documentId, @PathVariable UUID id) {
        return response(
                proposals.find(workspaceId, documentId, users.requireCurrentUser().id(), id));
    }
    @PostMapping("/proposals/calculation") public ResponseEntity<Proposal> calculation(
            @PathVariable UUID workspaceId,@PathVariable UUID documentId,@RequestBody CalculationPackageContracts.Request request) {
        return response(calculations.prepare(workspaceId,documentId,users.requireCurrentUser().id(),request));
    }

    @PostMapping("/proposals/{id}/reject")
    public ResponseEntity<Proposal> reject(
            @PathVariable UUID workspaceId, @PathVariable UUID documentId, @PathVariable UUID id) {
        return response(
                proposals.reject(workspaceId, documentId, users.requireCurrentUser().id(), id));
    }

    @PostMapping("/proposals/{id}/accept")
    public ResponseEntity<Receipt> accept(
            @PathVariable UUID workspaceId,
            @PathVariable UUID documentId,
            @PathVariable UUID id,
            @RequestBody Accept request) {
        return response(
                apply(
                        operations.accept(
                                workspaceId,
                                documentId,
                                users.requireCurrentUser().id(),
                                id,
                                request)));
    }

    @PostMapping("/operations/{id}/undo")
    public ResponseEntity<Receipt> undo(
            @PathVariable UUID workspaceId,
            @PathVariable UUID documentId,
            @PathVariable UUID id,
            @RequestBody Undo request) {
        return response(
                apply(
                        operations.undo(
                                workspaceId,
                                documentId,
                                users.requireCurrentUser().id(),
                                id,
                                request)));
    }

    private Receipt apply(Operation op) {
        if (op.epoch() != null) return bridge.apply(op.id(), op.documentId(), op.epoch());
        return op.receipt();
    }

    private static <T> ResponseEntity<T> response(T body) {
        return ResponseEntity.ok().header("Cache-Control", "private, no-store").body(body);
    }
}
