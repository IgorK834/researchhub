package dev.researchhub.security.api;

import dev.researchhub.auth.application.CurrentUserResolver;
import dev.researchhub.workspace.application.WorkspaceAuthorizationService;
import dev.researchhub.security.application.*;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.web.method.HandlerMethod;
import org.springframework.web.servlet.HandlerInterceptor;
import org.springframework.web.servlet.HandlerMapping;
import java.util.Map;
import java.util.UUID;

/** Security/CSRF filters run first; workspace access is checked before consuming a quota. */
public final class CostlyRequestInterceptor implements HandlerInterceptor {
    private static final String ADMITTED = CostlyRequestInterceptor.class.getName() + ".admitted";
    private final CurrentUserResolver users;
    private final WorkspaceAuthorizationService authorization;
    private final CostQuotaStore store;
    private final Map<CostCategory, QuotaPolicy> policies;

    public CostlyRequestInterceptor(CurrentUserResolver users, WorkspaceAuthorizationService authorization,
                                    CostQuotaStore store, Map<CostCategory, QuotaPolicy> policies) {
        this.users = users; this.authorization = authorization; this.store = store;
        this.policies = Map.copyOf(policies);
    }

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) {
        if (!(handler instanceof HandlerMethod method)) return true;
        CostlyOperation operation = method.getMethodAnnotation(CostlyOperation.class);
        if (operation == null || Boolean.TRUE.equals(request.getAttribute(ADMITTED))) return true;
        Object variables = request.getAttribute(HandlerMapping.URI_TEMPLATE_VARIABLES_ATTRIBUTE);
        if (!(variables instanceof Map<?, ?> paths) || !(paths.get("workspaceId") instanceof String id)) {
            throw new IllegalStateException("Costly endpoints must declare a workspaceId path variable");
        }
        UUID workspace;
        try { workspace = UUID.fromString(id); }
        catch (IllegalArgumentException invalid) {
            throw new dev.researchhub.shared.error.ApiException(dev.researchhub.shared.error.ApiErrorCode.MALFORMED_REQUEST,
                    "The workspace identifier is invalid");
        }
        UUID user = users.requireCurrentUser().id();
        switch (operation.access()) {
            case READ -> authorization.requireContentReader(workspace, user);
            case EDIT -> authorization.requireContentEditor(workspace, user);
            case AI_CONTRIBUTOR -> authorization.requireAiContributor(workspace, user);
        }
        store.admit(user, workspace, operation.value(), policies.get(operation.value()));
        // Servlet async/SSE redispatch is part of the same request, not a second operation.
        request.setAttribute(ADMITTED, true);
        return true;
    }
}
