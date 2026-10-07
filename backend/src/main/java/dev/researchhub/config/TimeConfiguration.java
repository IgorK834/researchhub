package dev.researchhub.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.time.Clock;
import java.time.Duration;

/**
 * The application's clock.
 *
 * <p>Injected rather than called statically so code that stamps a timestamp can be tested at a fixed
 * instant. UTC because every stored timestamp is {@code timestamptz} and the JDBC time zone is UTC
 * (docs/development/persistence.md); reading the host's zone here would make behaviour depend on where
 * the process runs.
 *
 * <p>Ticks at microsecond resolution, which is all {@code timestamptz} stores. On Linux the system clock
 * reports nanoseconds, so an unrounded instant returned from a write would differ from the same value
 * read back from Postgres.
 */
@Configuration
public class TimeConfiguration {

    @Bean
    Clock clock() {
        return Clock.tick(Clock.systemUTC(), Duration.ofNanos(1_000));
    }

}
