package dev.researchhub.shared.infrastructure.persistence;

import ch.qos.logback.classic.Level;
import jakarta.annotation.PostConstruct;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Profile;

@Configuration
@Profile("local")
@ConditionalOnProperty(prefix = "researchhub.debug", name = "sql", havingValue = "true")
public class LocalSqlDebugConfiguration {

    @PostConstruct
    void enableSqlLogging() {
        if (LoggerFactory.getLogger("org.hibernate.SQL") instanceof ch.qos.logback.classic.Logger logger) {
            logger.setLevel(Level.DEBUG);
        }
    }

}
