package dev.researchhub.security.infrastructure;

import dev.researchhub.auth.application.CurrentUserResolver;
import dev.researchhub.workspace.application.WorkspaceAuthorizationService;
import dev.researchhub.security.application.*;
import dev.researchhub.security.api.CostlyRequestInterceptor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.scheduling.annotation.EnableScheduling;
import io.micrometer.core.instrument.MeterRegistry;
import org.springframework.context.annotation.*;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;
import java.time.Clock;
import java.time.Duration;
import java.util.Map;

@Configuration
@EnableScheduling
public class CostQuotaConfiguration {
    public CostQuotaConfiguration(@Value("${researchhub.security.quotas.store:memory}") String store) {
        if (!"memory".equals(store) && !"postgres".equals(store)) {
            throw new IllegalArgumentException("Quota store must be memory or postgres");
        }
    }

    @Bean
    @ConditionalOnMissingBean(CostQuotaStore.class)
    @ConditionalOnProperty(prefix = "researchhub.security.quotas", name = "store", havingValue = "memory", matchIfMissing = true)
    CostQuotaStore costQuotaStore(Clock clock, MeterRegistry registry,
            @Value("${researchhub.security.quotas.max-buckets:100000}") int maxBuckets) {
        return new InMemoryCostQuotaStore(clock, maxBuckets, registry);
    }

    @Bean
    @ConditionalOnMissingBean(CostQuotaStore.class)
    @ConditionalOnProperty(prefix = "researchhub.security.quotas", name = "store", havingValue = "postgres")
    PostgresCostQuotaStore postgresCostQuotaStore(NamedParameterJdbcTemplate jdbc, PlatformTransactionManager manager,
            Clock clock, MeterRegistry registry,
            @Value("${researchhub.security.quotas.retention:P7D}") Duration retention,
            @Value("${researchhub.security.quotas.window:PT1M}") Duration window,
            @Value("${researchhub.security.quotas.max-attempts:3}") int maxAttempts) {
        return new PostgresCostQuotaStore(jdbc, manager, clock, registry, retention, window, maxAttempts);
    }

    @Bean("costQuotaPolicies")
    Map<CostCategory, QuotaPolicy> costQuotaPolicies(
            @Value("${researchhub.security.quotas.window:PT1M}") Duration window,
            @Value("${researchhub.security.quotas.llm.user:20}") int llmUser,
            @Value("${researchhub.security.quotas.llm.workspace:60}") int llmWorkspace,
            @Value("${researchhub.security.quotas.analysis.user:10}") int analysisUser,
            @Value("${researchhub.security.quotas.analysis.workspace:30}") int analysisWorkspace,
            @Value("${researchhub.security.quotas.retrieval.user:60}") int retrievalUser,
            @Value("${researchhub.security.quotas.retrieval.workspace:180}") int retrievalWorkspace,
            @Value("${researchhub.security.quotas.metadata-lookup.user:10}") int metadataLookupUser,
            @Value("${researchhub.security.quotas.metadata-lookup.workspace:30}") int metadataLookupWorkspace,
            @Value("${researchhub.security.quotas.bibliography-import.user:10}") int bibliographyImportUser,
            @Value("${researchhub.security.quotas.bibliography-import.workspace:30}") int bibliographyImportWorkspace) {
        return Map.of(
                CostCategory.LLM, new QuotaPolicy(llmUser, llmWorkspace, window),
                CostCategory.ANALYSIS, new QuotaPolicy(analysisUser, analysisWorkspace, window),
                CostCategory.RETRIEVAL, new QuotaPolicy(retrievalUser, retrievalWorkspace, window),
                CostCategory.METADATA_LOOKUP, new QuotaPolicy(metadataLookupUser, metadataLookupWorkspace, window),
                CostCategory.BIBLIOGRAPHY_IMPORT, new QuotaPolicy(bibliographyImportUser, bibliographyImportWorkspace, window));
    }

    @Bean
    @ConditionalOnWebApplication(type = ConditionalOnWebApplication.Type.SERVLET)
    WebMvcConfigurer costlyRequestAdmission(CurrentUserResolver users, WorkspaceAuthorizationService authorization,
            CostQuotaStore store, @org.springframework.beans.factory.annotation.Qualifier("costQuotaPolicies") Map<CostCategory, QuotaPolicy> policies) {
        CostlyRequestInterceptor admission = new CostlyRequestInterceptor(users, authorization, store, policies);
        return new WebMvcConfigurer() {
            @Override public void addInterceptors(InterceptorRegistry registry) {
                registry.addInterceptor(admission).addPathPatterns("/api/workspaces/**");
            }
        };
    }
}
