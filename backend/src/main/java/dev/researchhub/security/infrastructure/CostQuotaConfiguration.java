package dev.researchhub.security.infrastructure;

import dev.researchhub.auth.application.CurrentUserResolver;
import dev.researchhub.workspace.application.WorkspaceAuthorizationService;
import dev.researchhub.security.application.*;
import dev.researchhub.security.api.CostlyRequestInterceptor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.context.annotation.*;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;
import java.time.Clock;
import java.time.Duration;
import java.util.Map;

@Configuration
@Profile("local")
public class CostQuotaConfiguration {
    @Bean
    @ConditionalOnMissingBean(CostQuotaStore.class)
    CostQuotaStore costQuotaStore(Clock clock,
            @Value("${researchhub.security.quotas.max-buckets:100000}") int maxBuckets) {
        return new InMemoryCostQuotaStore(clock, maxBuckets);
    }

    @Bean
    @ConditionalOnWebApplication(type = ConditionalOnWebApplication.Type.SERVLET)
    WebMvcConfigurer costlyRequestAdmission(CurrentUserResolver users, WorkspaceAuthorizationService authorization,
            CostQuotaStore store,
            @Value("${researchhub.security.quotas.window:PT1M}") Duration window,
            @Value("${researchhub.security.quotas.llm.user:20}") int llmUser,
            @Value("${researchhub.security.quotas.llm.workspace:60}") int llmWorkspace,
            @Value("${researchhub.security.quotas.analysis.user:10}") int analysisUser,
            @Value("${researchhub.security.quotas.analysis.workspace:30}") int analysisWorkspace,
            @Value("${researchhub.security.quotas.retrieval.user:60}") int retrievalUser,
            @Value("${researchhub.security.quotas.retrieval.workspace:180}") int retrievalWorkspace) {
        CostlyRequestInterceptor admission = new CostlyRequestInterceptor(users, authorization, store, Map.of(
                CostCategory.LLM, new QuotaPolicy(llmUser, llmWorkspace, window),
                CostCategory.ANALYSIS, new QuotaPolicy(analysisUser, analysisWorkspace, window),
                CostCategory.RETRIEVAL, new QuotaPolicy(retrievalUser, retrievalWorkspace, window)));
        return new WebMvcConfigurer() {
            @Override public void addInterceptors(InterceptorRegistry registry) {
                registry.addInterceptor(admission).addPathPatterns("/api/workspaces/**");
            }
        };
    }
}
