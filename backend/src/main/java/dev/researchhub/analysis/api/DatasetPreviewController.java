package dev.researchhub.analysis.api;

import dev.researchhub.analysis.application.DatasetPreview;
import dev.researchhub.analysis.application.DatasetPreviewService;
import dev.researchhub.auth.application.CurrentUserResolver;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.UUID;

/** Workspace-authorized, bounded dataset structure for browsers and future planners. */
@RestController
@RequestMapping("/api/workspaces/{workspaceId}/analysis/datasets")
public class DatasetPreviewController {
    private final DatasetPreviewService previews;
    private final CurrentUserResolver users;
    public DatasetPreviewController(DatasetPreviewService previews, CurrentUserResolver users) {
        this.previews = previews; this.users = users;
    }

    @GetMapping("/{sourceId}/versions/{versionId}/preview")
    ResponseEntity<DatasetPreview> preview(@PathVariable UUID workspaceId, @PathVariable UUID sourceId,
                                           @PathVariable UUID versionId) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore())
                .body(previews.preview(workspaceId, sourceId, versionId, users.requireCurrentUser().id()));
    }
}
