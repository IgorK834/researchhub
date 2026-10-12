package dev.researchhub.ai.observability;

import dev.researchhub.security.application.*;
import dev.researchhub.shared.error.*;
import dev.researchhub.workspace.application.WorkspaceAuthorizationService;
import dev.researchhub.workspace.domain.WorkspaceCapability;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.jdbc.core.JdbcTemplate;
import java.sql.Timestamp;
import java.time.*;
import java.util.*;

/** Owner-facing economic projection. No diagnostic JSON or content columns are read. */
@Service
public class WorkspaceAiUsageService {
    public record FeatureUsage(String feature, long requests, long failures, long usageKnown, Long inputTokens, Long outputTokens) {}
    public record Summary(Instant from, Instant to, List<FeatureUsage> features, List<CostQuotaStore.Consumption> quotas) {}
    private final WorkspaceAuthorizationService authorization;
    private final JdbcTemplate jdbc;
    private final CostQuotaStore quotas;
    private final Map<CostCategory, QuotaPolicy> policies;
    private final Clock clock;
    public WorkspaceAiUsageService(WorkspaceAuthorizationService authorization, JdbcTemplate jdbc, CostQuotaStore quotas,
            @Qualifier("costQuotaPolicies") Map<CostCategory, QuotaPolicy> policies, Clock clock) {
        this.authorization=authorization; this.jdbc=jdbc; this.quotas=quotas; this.policies=policies; this.clock=clock;
    }
    @Transactional(readOnly=true)
    public Summary summary(UUID workspace, UUID caller, int days) {
        authorization.requireCapability(workspace,caller,WorkspaceCapability.MANAGE_WORKSPACE);
        if (days<1 || days>90) throw new ApiException(ApiErrorCode.VALIDATION_FAILED,"Choose a usage window between 1 and 90 days");
        Instant to=clock.instant(), from=to.minus(Duration.ofDays(days));
        var features=jdbc.query("""
            SELECT feature,count(*) AS requests,count(*) FILTER (WHERE status='FAILED') AS failures,
                count(input_tokens) AS known,sum(input_tokens)::bigint AS inputs,sum(output_tokens)::bigint AS outputs
            FROM ai_usage_events WHERE workspace_id=? AND started_at>=? AND started_at<? GROUP BY feature ORDER BY feature
            """, (r,i)->new FeatureUsage(r.getString("feature"),r.getLong("requests"),r.getLong("failures"),r.getLong("known"),
                r.getObject("inputs",Long.class),r.getObject("outputs",Long.class)),workspace,Timestamp.from(from),Timestamp.from(to));
        return new Summary(from,to,features,Arrays.stream(CostCategory.values()).map(c->quotas.consumption(workspace,c,policies.get(c))).toList());
    }
}
