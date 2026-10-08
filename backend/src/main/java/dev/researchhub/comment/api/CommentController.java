package dev.researchhub.comment.api;

import dev.researchhub.security.application.CostlyOperation;
import dev.researchhub.security.application.CostCategory;
import dev.researchhub.auth.application.CurrentUserResolver;
import dev.researchhub.comment.application.CommentContracts;
import dev.researchhub.comment.application.CommentService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/api/workspaces/{workspaceId}/documents/{documentId}/comments")
public class CommentController {
    public record AnchorRequest(@NotNull @Pattern(regexp = "TEXT_MARK_V1") String strategy, @NotNull UUID id,
                                @NotBlank @Size(max = 2000) String quote) {}
    public record CreateRequest(@NotNull UUID id, @NotBlank @Size(max = 4000) String body, @NotNull @Valid AnchorRequest anchor) {}
    public record ReplyRequest(@NotNull UUID id, @NotBlank @Size(max = 4000) String body) {}
    public record StatusRequest(@NotNull @Pattern(regexp = "OPEN|RESOLVED") String status) {}
    public record EvidenceRequest(@NotNull UUID id) {}
    public record AcceptEvidenceRequest(@NotNull @Pattern(regexp = "[a-f0-9]{64}") String chunkId) {}
    private final CommentService comments;
    private final CurrentUserResolver users;
    private final dev.researchhub.comment.application.CommentEvidenceService evidence;
    private final dev.researchhub.comment.application.CommentEvidenceWriter evidenceWriter;
    public CommentController(CommentService comments, CurrentUserResolver users,
            dev.researchhub.comment.application.CommentEvidenceService evidence, dev.researchhub.comment.application.CommentEvidenceWriter evidenceWriter) {
        this.comments = comments; this.users = users; this.evidence=evidence; this.evidenceWriter=evidenceWriter;
    }

    @CostlyOperation(value = CostCategory.LLM, access = CostlyOperation.Access.AI_CONTRIBUTOR)
    @PostMapping("/{commentId}/ai-evidence")
    @ResponseStatus(HttpStatus.CREATED)
    CommentContracts.Comment evidence(@PathVariable UUID workspaceId, @PathVariable UUID documentId, @PathVariable UUID commentId,
                                     @Valid @RequestBody EvidenceRequest request) {
        return evidence.invoke(workspaceId,documentId,caller(),commentId,request.id());
    }
    @PostMapping("/{commentId}/ai-evidence/{suggestionId}/accept")
    CommentContracts.Comment acceptEvidence(@PathVariable UUID workspaceId, @PathVariable UUID documentId, @PathVariable UUID commentId,
            @PathVariable UUID suggestionId, @Valid @RequestBody AcceptEvidenceRequest request) {
        return evidenceWriter.accept(workspaceId,documentId,caller(),commentId,suggestionId,request.chunkId());
    }

    @GetMapping
    List<CommentContracts.Comment> list(@PathVariable UUID workspaceId, @PathVariable UUID documentId) {
        return comments.list(workspaceId, caller(), documentId);
    }
    @GetMapping("/{commentId}")
    CommentContracts.Thread thread(@PathVariable UUID workspaceId, @PathVariable UUID documentId, @PathVariable UUID commentId) {
        return comments.thread(workspaceId, caller(), documentId, commentId);
    }
    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    CommentContracts.Comment create(@PathVariable UUID workspaceId, @PathVariable UUID documentId, @Valid @RequestBody CreateRequest request) {
        return comments.create(workspaceId, caller(), documentId, new CommentContracts.Create(request.id(), request.body(),
                new CommentContracts.Anchor(request.anchor().strategy(), request.anchor().id(), request.anchor().quote())));
    }
    @PostMapping("/{commentId}/replies")
    @ResponseStatus(HttpStatus.CREATED)
    CommentContracts.Comment reply(@PathVariable UUID workspaceId, @PathVariable UUID documentId, @PathVariable UUID commentId,
                                   @Valid @RequestBody ReplyRequest request) {
        return comments.reply(workspaceId, caller(), documentId, commentId, request.id(), request.body());
    }
    @PatchMapping("/{commentId}")
    CommentContracts.Comment status(@PathVariable UUID workspaceId, @PathVariable UUID documentId, @PathVariable UUID commentId,
                                    @Valid @RequestBody StatusRequest request) {
        return comments.status(workspaceId, caller(), documentId, commentId, request.status());
    }
    private UUID caller() { return users.requireCurrentUser().id(); }
}
