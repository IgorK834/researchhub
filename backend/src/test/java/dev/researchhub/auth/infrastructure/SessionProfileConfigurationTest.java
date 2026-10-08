package dev.researchhub.auth.infrastructure;

import org.junit.jupiter.api.Test;
import org.springframework.boot.WebApplicationType;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.context.annotation.Configuration;
import static org.junit.jupiter.api.Assertions.*;

/** Loads actual ConfigData without starting infrastructure; product E2E separately proves JDBC activation. */
class SessionProfileConfigurationTest {
    @Configuration(proxyBeanMethods = false)
    static class Probe {}

    @Test void deploymentOverlaysSelectJdbcWhileLocalAndTestRemainServlet() {
        for (String profile : new String[]{"local", "test", "demo", "azure"}) {
            try (var app = new SpringApplicationBuilder(Probe.class).web(WebApplicationType.NONE).profiles(profile).run("--DB_URL=jdbc:postgresql://localhost/test", "--DB_USER=test", "--DB_PASSWORD=test",
                    "--BLOB_ENDPOINT=https://example.blob.core.windows.net", "--BLOB_CONNECTION_STRING=test-only",
                    "--AI_WORKER_BASE_URL=http://worker:8090", "--AI_WORKER_SERVICE_TOKEN=" + "w".repeat(32),
                    "--METRICS_SCRAPE_TOKEN=" + "m".repeat(32))) {
                var environment = app.getEnvironment();
                assertEquals(profile.equals("demo") || profile.equals("azure") ? "jdbc" : "servlet",
                        environment.getProperty("researchhub.auth.session-store"), profile);
                assertEquals("never", environment.getProperty("spring.session.jdbc.initialize-schema"));
                assertEquals("JSESSIONID", environment.getProperty("server.servlet.session.cookie.name"));
                assertEquals("30m", environment.getProperty("server.servlet.session.timeout"));
                assertEquals("on-save", environment.getProperty("spring.session.jdbc.flush-mode"));
                assertEquals("on-set-attribute", environment.getProperty("spring.session.jdbc.save-mode"));
                assertEquals("0 * * * * *", environment.getProperty("spring.session.jdbc.cleanup-cron"));
                assertEquals(profile.equals("azure"), environment.getProperty("server.servlet.session.cookie.secure", Boolean.class));
                if (profile.equals("azure")) {
                    assertEquals("cloud", environment.getProperty("researchhub.environment"));
                    assertEquals("", environment.getProperty("researchhub.auth.cors.allowed-origins"));
                }
            }
        }
    }
}
