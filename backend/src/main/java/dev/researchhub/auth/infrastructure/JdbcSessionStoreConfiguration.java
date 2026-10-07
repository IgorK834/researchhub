package dev.researchhub.auth.infrastructure;

import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.SmartInitializingSingleton;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.session.jdbc.JdbcIndexedSessionRepository;

/** A JDBC selection must fail startup rather than silently fall back to replica-local sessions. */
@Configuration(proxyBeanMethods = false)
@ConditionalOnWebApplication(type = ConditionalOnWebApplication.Type.SERVLET)
@ConditionalOnProperty(name = "researchhub.auth.session-store", havingValue = "jdbc")
public class JdbcSessionStoreConfiguration {
    @Bean
    SmartInitializingSingleton requireJdbcSessionRepository(ObjectProvider<JdbcIndexedSessionRepository> repository) {
        return () -> {
            if (repository.getIfAvailable() == null) {
                throw new IllegalStateException("researchhub.auth.session-store=jdbc requires a JDBC session repository and datasource");
            }
        };
    }
}
