package dev.researchhub.audit.application;

import dev.researchhub.audit.infrastructure.PostgresProductAudit;
import dev.researchhub.workspace.application.WorkspaceAuthorizationService;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.util.List;
import java.util.UUID;

@Service
@Profile("local")
public class ProductAuditQuery {
    public record Page(List<ProductAudit.Event> events, UUID nextCursor) {}
    private final PostgresProductAudit store;
    private final WorkspaceAuthorizationService authorization;
    public ProductAuditQuery(PostgresProductAudit store, WorkspaceAuthorizationService authorization) {
        this.store=store; this.authorization=authorization;
    }
    @Transactional(readOnly = true)
    public Page list(UUID workspace, UUID caller, int limit, UUID before) {
        authorization.requireContentReader(workspace,caller);
        if (limit<1 || limit>100) throw new IllegalArgumentException("Audit page size must be between 1 and 100");
        var rows=store.page(workspace,limit+1,before);
        var events=rows.stream().limit(limit).toList();
        return new Page(events,rows.size()>limit ? events.getLast().id() : null);
    }
}
