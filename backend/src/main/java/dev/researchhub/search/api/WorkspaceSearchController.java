package dev.researchhub.search.api;

import dev.researchhub.auth.application.CurrentUserResolver;
import dev.researchhub.search.application.WorkspaceSearchContracts.Page;
import dev.researchhub.search.application.WorkspaceSearchService;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

@RestController
@RequestMapping("/api/workspaces/{workspaceId}/search")
public class WorkspaceSearchController {
    private final WorkspaceSearchService search;
    private final CurrentUserResolver users;

    public WorkspaceSearchController(WorkspaceSearchService search, CurrentUserResolver users) {
        this.search = search;
        this.users = users;
    }

    @GetMapping
    ResponseEntity<Page> search(@PathVariable UUID workspaceId, @RequestParam(defaultValue="") String q,
                                @RequestParam(defaultValue = "") String types,
                                @RequestParam(required = false) String cursor,
                                @RequestParam(defaultValue = "20") String limit) {
        int boundedLimit;
        try{boundedLimit=Integer.parseInt(limit);}catch(NumberFormatException bad){throw new dev.researchhub.shared.error.ApiException(dev.researchhub.shared.error.ApiErrorCode.VALIDATION_FAILED,"Search limit must be an integer");}
        return ResponseEntity.ok().cacheControl(CacheControl.noStore())
                .body(search.search(workspaceId, users.requireCurrentUser().id(), q, types, cursor, boundedLimit));
    }
}
