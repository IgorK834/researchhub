package dev.researchhub.security.application;

import java.util.UUID;

/**
 * Atomically checks and consumes BOTH a user's global budget and a workspace's global budget.
 * A rejection consumes neither. A shared-store adapter must retain these semantics across instances.
 * Windows are aligned to the Unix epoch by truncating the injected Clock to policy.window().
 * An admitted request remains charged even when subsequent application work fails.
 */
public interface CostQuotaStore {
    void admit(UUID userId, UUID workspaceId, CostCategory category, QuotaPolicy policy);
}
