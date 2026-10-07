package dev.researchhub.auth.infrastructure;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.runner.WebApplicationContextRunner;
import org.springframework.session.jdbc.JdbcIndexedSessionRepository;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

class JdbcSessionStoreConfigurationTest {
    private final WebApplicationContextRunner context = new WebApplicationContextRunner()
            .withUserConfiguration(JdbcSessionStoreConfiguration.class);

    @Test void jdbcCannotSilentlyBecomeServletWhenTheDatasourceIsMissing() {
        context.withPropertyValues("researchhub.auth.session-store=jdbc").run(app ->
                assertThat(app).hasFailed().getFailure().hasMessageContaining("requires a JDBC session repository"));
    }

    @Test void jdbcAcceptsTheConfiguredRepository() {
        context.withPropertyValues("researchhub.auth.session-store=jdbc")
                .withBean(JdbcIndexedSessionRepository.class, () -> mock(JdbcIndexedSessionRepository.class))
                .run(app -> assertThat(app).hasNotFailed().hasSingleBean(JdbcIndexedSessionRepository.class));
    }

    @Test void servletNeedsNoSharedRepository() {
        context.withPropertyValues("researchhub.auth.session-store=servlet")
                .run(app -> assertThat(app).hasNotFailed().doesNotHaveBean("requireJdbcSessionRepository"));
    }
}
