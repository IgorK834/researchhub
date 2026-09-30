package dev.researchhub.ai.api;

import dev.researchhub.ai.application.*;
import dev.researchhub.auth.application.CurrentUserResolver;
import org.springframework.context.annotation.Profile;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import java.util.UUID;

/** Authorized current retrieval substrate, not an AI generation or search execution endpoint. */
@RestController
@Profile("local")
@RequestMapping("/api/workspaces/{workspaceId}/sources/{sourceId}/retrieval")
public class SourceRetrievalController {
    private final SourceRetrievalService retrieval;
    private final CurrentUserResolver currentUser;
    public SourceRetrievalController(SourceRetrievalService retrieval, CurrentUserResolver currentUser) { this.retrieval = retrieval; this.currentUser = currentUser; }
    @GetMapping
    ResponseEntity<RetrievalChunkSet> get(@PathVariable UUID workspaceId, @PathVariable UUID sourceId,
                                        @RequestParam(required = false) String processingVersion) {
        var set = retrieval.find(workspaceId, sourceId, currentUser.requireCurrentUser().id(), processingVersion);
        return set == null ? ResponseEntity.noContent().header("Cache-Control", "private, no-store").build()
                : ResponseEntity.ok().header("Cache-Control", "private, no-store").body(set);
    }
    @GetMapping("/chunks/{chunkId}")
    ResponseEntity<RetrievalChunk> chunk(@PathVariable UUID workspaceId, @PathVariable UUID sourceId, @PathVariable String chunkId,
                                        @RequestParam(required = false) String processingVersion) {
        return ResponseEntity.ok().header("Cache-Control", "private, no-store").body(
                retrieval.chunk(workspaceId, sourceId, currentUser.requireCurrentUser().id(), chunkId, processingVersion));
    }
}
