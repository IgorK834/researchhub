package dev.researchhub.ai.api;

import dev.researchhub.security.application.CostlyOperation;
import dev.researchhub.security.application.CostCategory;
import dev.researchhub.ai.application.*;
import dev.researchhub.ai.application.ConversationContracts.*;
import dev.researchhub.auth.application.CurrentUserResolver;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;
import java.util.UUID;

@RestController
@RequestMapping("/api/workspaces/{workspaceId}/ai/conversations")
public class ConversationController {
    private final ConversationService conversations;
    private final ConversationStreams streams;
    private final CurrentUserResolver users;
    public ConversationController(ConversationService conversations,ConversationStreams streams,CurrentUserResolver users) {
        this.conversations=conversations; this.streams=streams; this.users=users;
    }
    @PostMapping ResponseEntity<Conversation> create(@PathVariable UUID workspaceId,@RequestBody Create create) {
        return ResponseEntity.status(201).header("Cache-Control","private, no-store")
            .body(conversations.create(workspaceId,users.requireCurrentUser().id(),create));
    }
    @GetMapping ResponseEntity<ConversationPage> list(@PathVariable UUID workspaceId,
        @RequestParam(defaultValue="0") int offset,@RequestParam(defaultValue="25") int limit) {
        return noStore(conversations.list(workspaceId,users.requireCurrentUser().id(),offset,limit));
    }
    @GetMapping("/{conversationId}") ResponseEntity<History> history(@PathVariable UUID workspaceId,@PathVariable UUID conversationId,
        @RequestParam(required=false) Long beforeSequence,@RequestParam(defaultValue="25") int limit) {
        return noStore(conversations.history(workspaceId,users.requireCurrentUser().id(),conversationId,beforeSequence,limit));
    }
    @CostlyOperation(value = CostCategory.LLM, access = CostlyOperation.Access.READ)
    @PostMapping("/{conversationId}/messages") ResponseEntity<Completion> send(@PathVariable UUID workspaceId,@PathVariable UUID conversationId,@RequestBody Send send) {
        return noStore(conversations.send(workspaceId,users.requireCurrentUser().id(),conversationId,send,QuestionExecution.NONE));
    }
    @CostlyOperation(value = CostCategory.LLM, access = CostlyOperation.Access.READ)
    @PostMapping(value="/{conversationId}/messages/stream",produces=MediaType.TEXT_EVENT_STREAM_VALUE)
    ResponseEntity<SseEmitter> stream(@PathVariable UUID workspaceId,@PathVariable UUID conversationId,@RequestBody Send send) {
        return ResponseEntity.ok().header("Cache-Control","private, no-store, no-transform").header("X-Accel-Buffering","no")
            .body(streams.open(workspaceId,users.requireCurrentUser().id(),conversationId,send));
    }
    private static <T> ResponseEntity<T> noStore(T body) { return ResponseEntity.ok().header("Cache-Control","private, no-store").body(body); }
}
