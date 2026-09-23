package dev.researchhub.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.time.Clock;

/**
 * The application's clock.
 *
 * <p>Injected rather than called statically so code that stamps a timestamp can be tested at a fixed
 * instant. UTC because every stored timestamp is {@code timestamptz} and the JDBC time zone is UTC
 * (docs/development/persistence.md); reading the host's zone here would make behaviour depend on where
 * the process runs.
 */
@Configuration
public class TimeConfiguration {

    @Bean
    Clock clock() {
        return Clock.systemUTC();
    }

}
