package dev.researchhub.support;

import dev.researchhub.BackendApplication;
import dev.researchhub.source.application.InMemorySourceStorage;
import dev.researchhub.source.application.SourceStorage;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.context.annotation.Bean;
import org.testcontainers.postgresql.PostgreSQLContainer;

import java.util.ArrayList;
import java.util.List;

/** Independent application instances: only PostgreSQL and browser cookies are shared. */
public final class SessionTestApplications {
    private SessionTestApplications() {}

    public static ConfigurableApplicationContext start(PostgreSQLContainer database, String store, String... overrides) {
        List<String> arguments = new ArrayList<>(List.of(
                "--server.port=0", "--spring.datasource.url=" + database.getJdbcUrl(),
                "--spring.datasource.username=" + database.getUsername(),
                "--spring.datasource.password=" + database.getPassword(),
                "--researchhub.auth.session-store=" + store,
                "--researchhub.sources.storage.adapter=in-memory",
                "--researchhub.processing.dispatcher.enabled=false",
                "--researchhub.analysis.execution.dispatcher.enabled=false",
                "--researchhub.analysis.sandbox.enabled=false",
                "--researchhub.export.dispatcher.enabled=false",
                "--researchhub.documents.history.scheduler.enabled=false",
                "--spring.session.jdbc.cleanup-cron=*/1 * * * * *"));
        arguments.addAll(List.of(overrides));
        return new SpringApplicationBuilder(BackendApplication.class, StorageConfiguration.class)
                .profiles("local").run(arguments.toArray(String[]::new));
    }

    public static int port(ConfigurableApplicationContext application) {
        return application.getEnvironment().getRequiredProperty("local.server.port", Integer.class);
    }

    @TestConfiguration(proxyBeanMethods = false)
    public static class StorageConfiguration {
        @Bean SourceStorage sourceStorage() { return new InMemorySourceStorage(); }
    }
}
