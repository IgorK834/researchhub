package dev.researchhub.ai.api;

import dev.researchhub.ai.application.*;
import dev.researchhub.auth.application.CurrentUserResolver;
import org.springframework.context.annotation.Profile;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import java.util.List;
import java.util.UUID;

@RestController
@Profile("local")
@RequestMapping("/api/workspaces/{workspaceId}/retrieval")
public class RetrievalSearchController {
    private final RetrievalSearchService search;
    private final CurrentUserResolver currentUser;
    public RetrievalSearchController(RetrievalSearchService search, CurrentUserResolver currentUser) { this.search = search; this.currentUser = currentUser; }
    @GetMapping("/search")
    ResponseEntity<List<RetrievalHit>> search(@PathVariable UUID workspaceId, @RequestParam String query,
        @RequestParam(required = false) List<UUID> sourceIds, @RequestParam(defaultValue = "10") int topK) {
        return ResponseEntity.ok().header("Cache-Control", "private, no-store").body(
            search.search(query, workspaceId, sourceIds, topK, currentUser.requireCurrentUser().id()));
    }
}
