package dev.researchhub.ai.api;
import dev.researchhub.ai.application.*;
import dev.researchhub.ai.application.CanvasConversationContracts.*;
import dev.researchhub.auth.application.CurrentUserResolver;
import dev.researchhub.security.application.*;
import org.springframework.web.bind.annotation.*;
import org.springframework.http.ResponseEntity;
import java.util.UUID;
@RestController
@RequestMapping("/api/workspaces/{workspaceId}/ai/conversations")
public class CanvasConversationController {
    private final CanvasConversationService conversations;private final CurrentUserResolver users;
    public CanvasConversationController(CanvasConversationService conversations,CurrentUserResolver users) {this.conversations=conversations;this.users=users;}
    @PostMapping("/contextual") ResponseEntity<TurnState> first(@PathVariable UUID workspaceId,@RequestBody FirstTurn request) {
        return accepted(conversations.first(workspaceId,users.requireCurrentUser().id(),request));
    }
    @PostMapping("/{conversationId}/turns") ResponseEntity<TurnState> send(@PathVariable UUID workspaceId,@PathVariable UUID conversationId,@RequestBody Turn request) {
        return accepted(conversations.send(workspaceId,users.requireCurrentUser().id(),conversationId,request));
    }
    @GetMapping("/{conversationId}/turns/{turnId}") ResponseEntity<TurnState> find(@PathVariable UUID workspaceId,@PathVariable UUID conversationId,@PathVariable UUID turnId) {
        return ResponseEntity.ok().header("Cache-Control","private, no-store").body(conversations.find(workspaceId,users.requireCurrentUser().id(),conversationId,turnId));
    }
    @PostMapping("/{conversationId}/turns/{turnId}/cancel") ResponseEntity<TurnState> cancel(@PathVariable UUID workspaceId,@PathVariable UUID conversationId,@PathVariable UUID turnId) {
        return ResponseEntity.ok().header("Cache-Control","private, no-store").body(conversations.cancel(workspaceId,users.requireCurrentUser().id(),conversationId,turnId));
    }
    private static ResponseEntity<TurnState> accepted(TurnState body) {return ResponseEntity.accepted().header("Cache-Control","private, no-store").body(body);}
}
