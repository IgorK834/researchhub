package dev.researchhub.ai.api;

import dev.researchhub.ai.application.*;
import dev.researchhub.ai.application.QuestionContracts.*;
import dev.researchhub.auth.application.CurrentUserResolver;
import org.springframework.context.annotation.Profile;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import java.util.UUID;

@RestController
@Profile("local")
@RequestMapping("/api/workspaces/{workspaceId}/ai/questions")
public class WorkspaceQuestionController {
    private final WorkspaceQuestionService questions;
    private final CurrentUserResolver users;
    public WorkspaceQuestionController(WorkspaceQuestionService questions, CurrentUserResolver users) {
        this.questions = questions; this.users = users;
    }
    @PostMapping
    ResponseEntity<Response> answer(@PathVariable UUID workspaceId, @RequestBody Question question) {
        return ResponseEntity.ok().header("Cache-Control", "private, no-store")
            .body(questions.answer(workspaceId, users.requireCurrentUser().id(), question));
    }
}
