package dev.researchhub.reviewtask.api;

import dev.researchhub.auth.application.CurrentUserResolver;
import dev.researchhub.reviewtask.application.ReviewTaskContracts.*;
import dev.researchhub.reviewtask.application.ReviewTaskService;
import dev.researchhub.workspace.application.WorkspacePeople;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;
import java.util.*;

@RestController
@RequestMapping("/api/workspaces/{workspaceId}")
public class ReviewTaskController {
    private final ReviewTaskService tasks;private final WorkspacePeople people;private final CurrentUserResolver users;
    public ReviewTaskController(ReviewTaskService tasks,WorkspacePeople people,CurrentUserResolver users) {this.tasks=tasks;this.people=people;this.users=users;}
    @GetMapping("/people") public List<WorkspacePeople.Person> people(@PathVariable UUID workspaceId,@RequestParam(defaultValue="") String q) {
        return people.search(workspaceId,caller(),q);
    }
    @GetMapping("/review-tasks") public Page list(@PathVariable UUID workspaceId,@RequestParam(defaultValue="ALL") Filter filter,
        @RequestParam(required=false) UUID cursor,@RequestParam(defaultValue="20") int limit) {return tasks.list(workspaceId,caller(),filter,cursor,limit);}
    @GetMapping("/review-tasks/{id}") public Task get(@PathVariable UUID workspaceId,@PathVariable UUID id) {return tasks.get(workspaceId,caller(),id);}
    @PostMapping("/review-tasks") @ResponseStatus(HttpStatus.CREATED)
    public Task create(@PathVariable UUID workspaceId,@RequestBody Create command) {return tasks.create(workspaceId,caller(),command);}
    @PatchMapping("/review-tasks/{id}") public Task update(@PathVariable UUID workspaceId,@PathVariable UUID id,@RequestBody Update command) {return tasks.update(workspaceId,caller(),id,command);}
    private UUID caller() {return users.requireCurrentUser().id();}
}
