package dev.researchhub.audit.api;

import dev.researchhub.audit.application.ProductAuditQuery;
import dev.researchhub.auth.application.CurrentUserResolver;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import org.springframework.web.bind.annotation.*;

import java.util.UUID;

/** Bounded workspace-scoped product history; there are no mutation routes. */
@RestController
@RequestMapping("/api/workspaces/{workspaceId}/audit-events")
public class ProductAuditController {
    private final ProductAuditQuery query;
    private final CurrentUserResolver users;
    public ProductAuditController(ProductAuditQuery query, CurrentUserResolver users) {
        this.query=query; this.users=users;
    }
    @GetMapping
    ProductAuditQuery.Page list(@PathVariable UUID workspaceId, @RequestParam(defaultValue = "50") @Min(1) @Max(100) int limit,
              @RequestParam(required = false) UUID before) {
        return query.list(workspaceId, users.requireCurrentUser().id(), limit, before);
    }
}
