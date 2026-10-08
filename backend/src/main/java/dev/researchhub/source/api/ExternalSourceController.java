package dev.researchhub.source.api;

import dev.researchhub.auth.application.CurrentUserResolver;
import dev.researchhub.source.application.ExternalSourceService;
import dev.researchhub.source.application.ExternalSourceContracts.*;
import dev.researchhub.security.application.CostlyOperation;
import dev.researchhub.security.application.CostCategory;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import java.util.UUID;

@RestController
@RequestMapping("/api/workspaces/{workspaceId}/external-sources")
public class ExternalSourceController {
    private final ExternalSourceService sources;
    private final CurrentUserResolver users;
    public ExternalSourceController(ExternalSourceService sources, CurrentUserResolver users) { this.sources = sources; this.users = users; }
    @GetMapping("/availability")
    ResponseEntity<Availability> availability(@PathVariable UUID workspaceId) {
        return response(sources.availability(workspaceId, users.requireCurrentUser().id()));
    }
    @PostMapping("/search")
    @CostlyOperation(value = CostCategory.RETRIEVAL, access = CostlyOperation.Access.EDIT)
    ResponseEntity<Search> search(@PathVariable UUID workspaceId, @RequestBody SearchCommand command) {
        return response(sources.search(workspaceId, users.requireCurrentUser().id(), command));
    }
    @PostMapping
    ResponseEntity<Reference> record(@PathVariable UUID workspaceId, @RequestBody RecordCommand command) {
        return response(sources.record(workspaceId, users.requireCurrentUser().id(), command));
    }
    @GetMapping
    ResponseEntity<Page> list(@PathVariable UUID workspaceId, @RequestParam(defaultValue = "0") String page,
                              @RequestParam(defaultValue = "30") String size) {
        return response(sources.list(workspaceId, users.requireCurrentUser().id(), page, size));
    }
    private static <T> ResponseEntity<T> response(T value) {
        return ResponseEntity.ok().header("Cache-Control", "private, no-store").body(value);
    }
}
