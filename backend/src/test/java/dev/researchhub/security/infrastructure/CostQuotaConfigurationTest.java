package dev.researchhub.security.infrastructure;

import dev.researchhub.security.application.CostQuotaStore;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import java.time.Clock;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.transaction.PlatformTransactionManager;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

class CostQuotaConfigurationTest {
    private final ApplicationContextRunner context = new ApplicationContextRunner()
            .withInitializer(app -> app.getBeanFactory().setConversionService(
                    org.springframework.boot.convert.ApplicationConversionService.getSharedInstance()))
            .withUserConfiguration(CostQuotaConfiguration.class)
            .withPropertyValues("spring.profiles.active=local", "researchhub.security.quotas.cleanup-cron=-")
            .withBean(Clock.class, Clock::systemUTC)
            .withBean(MeterRegistry.class, SimpleMeterRegistry::new);

    @Test void memoryIsTheLocalDefault() {
        context.run(app -> assertThat(app).hasNotFailed().hasSingleBean(CostQuotaStore.class)
                .getBean(CostQuotaStore.class).isInstanceOf(InMemoryCostQuotaStore.class));
    }
    @Test void postgresSelectsTheSharedStore() {
        context.withPropertyValues("researchhub.security.quotas.store=postgres")
                .withBean(NamedParameterJdbcTemplate.class, () -> mock(NamedParameterJdbcTemplate.class))
                .withBean(PlatformTransactionManager.class, () -> mock(PlatformTransactionManager.class))
                .run(app -> assertThat(app).hasNotFailed().hasSingleBean(CostQuotaStore.class)
                        .getBean(CostQuotaStore.class).isInstanceOf(PostgresCostQuotaStore.class));
    }
    @Test void extensionHookOverridesBothSelectionsWithoutInfrastructure() {
        var custom = mock(CostQuotaStore.class);
        for (String store : new String[]{"memory", "postgres"}) context
                .withPropertyValues("researchhub.security.quotas.store=" + store)
                .withBean(CostQuotaStore.class, () -> custom)
                .run(app -> assertThat(app).hasNotFailed().hasSingleBean(CostQuotaStore.class)
                        .getBean(CostQuotaStore.class).isSameAs(custom));
    }
    @Test void unsupportedStoreCannotSilentlyDisableAdmission() {
        context.withPropertyValues("researchhub.security.quotas.store=redis")
                .run(app -> assertThat(app).hasFailed().getFailure().hasRootCauseMessage("Quota store must be memory or postgres"));
    }
}
