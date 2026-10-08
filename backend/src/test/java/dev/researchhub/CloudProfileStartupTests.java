package dev.researchhub;

import com.zaxxer.hikari.HikariConfig;
import dev.researchhub.config.CloudEnvironmentConfiguration;
import java.util.*;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;
import org.springframework.boot.WebApplicationType;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.boot.context.properties.bind.Binder;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.env.MapPropertySource;
import org.springframework.mock.env.MockEnvironment;
import static org.junit.jupiter.api.Assertions.*;

class CloudProfileStartupTests {
    @Configuration(proxyBeanMethods = false) static class Probe {}
    private static final List<String> REQUIRED = List.of("DB_URL", "DB_USER", "DB_PASSWORD", "BLOB_ENDPOINT",
        "BLOB_CONNECTION_STRING", "AI_WORKER_BASE_URL", "AI_WORKER_SERVICE_TOKEN", "METRICS_SCRAPE_TOKEN");

    static Map<String, String> valid() {
        return new LinkedHashMap<>(Map.of(
            "DB_URL", "jdbc:postgresql://localhost/researchhub", "DB_USER", "researchhub", "DB_PASSWORD", "test-only",
            "BLOB_ENDPOINT", "https://example.blob.core.windows.net", "BLOB_CONNECTION_STRING", "test-only",
            "AI_WORKER_BASE_URL", "http://worker:8090", "AI_WORKER_SERVICE_TOKEN", "w".repeat(32),
            "METRICS_SCRAPE_TOKEN", "m".repeat(32)));
    }
    static Stream<Object[]> missingSettings() {
        return Stream.of("azure", "cloud").flatMap(profile -> REQUIRED.stream().flatMap(name ->
            Stream.of("", " ").map(value -> new Object[]{profile, name, value})));
    }

    @ParameterizedTest @MethodSource("missingSettings")
    void failsBeforeInfrastructureStartupAndNamesEachMissingVariable(String profile, String missing, String value) {
        var values = valid(); values.put(missing, value);
        var failure = assertThrows(Exception.class, () -> new SpringApplicationBuilder(BackendApplication.class)
            .profiles(profile).web(WebApplicationType.NONE).run(args(values)));
        assertTrue(messages(failure).contains(missing), messages(failure));
    }

    @Test void azureAndCloudHaveTheSameSecurePersistenceAndPoolContract() {
        for (String profile : List.of("azure", "cloud")) {
            try (var app = new SpringApplicationBuilder(Probe.class).profiles(profile).web(WebApplicationType.NONE).run(args(valid()))) {
                var env = app.getEnvironment();
                assertFalse(Arrays.asList(env.getActiveProfiles()).contains("local"));
                assertEquals("jdbc", env.getProperty("researchhub.auth.session-store"));
                assertEquals("postgres", env.getProperty("researchhub.security.quotas.store"));
                assertEquals("jdbc:postgresql://localhost/researchhub", env.getProperty("spring.datasource.url"));
                assertEquals("researchhub", env.getProperty("spring.datasource.username"));
                assertEquals("test-only", env.getProperty("spring.datasource.password"));
                assertEquals("validate", env.getProperty("spring.jpa.hibernate.ddl-auto"));
                assertEquals("true", env.getProperty("spring.flyway.enabled"));
                assertNull(env.getProperty("spring.autoconfigure.exclude"));
                assertEquals("true", env.getProperty("server.servlet.session.cookie.secure"));
                assertEquals("none", env.getProperty("server.forward-headers-strategy"));
                assertEquals("health,prometheus", env.getProperty("management.endpoints.web.exposure.include"));
                assertEquals("false", env.getProperty("researchhub.analysis.sandbox.enabled"));
                assertNull(env.getProperty("researchhub.sources.storage.azure-blob.account-key"));
                var pool = Binder.get(env).bind("spring.datasource.hikari", HikariConfig.class).orElseThrow(() -> new AssertionError("Missing Hikari configuration"));
                assertEquals(8, pool.getMaximumPoolSize()); assertEquals(2, pool.getMinimumIdle());
                assertEquals(3000, pool.getConnectionTimeout()); assertEquals(240000, pool.getMaxLifetime());
                assertEquals(0, pool.getLeakDetectionThreshold());
            }
        }
    }

    @Test void stagingPoolAndTrustedIngressOverridesBind() {
        var values=valid(); values.put("DB_POOL_LEAK_DETECTION_THRESHOLD_MS", "20000");
        values.put("DB_POOL_MAX_SIZE", "6"); values.put("DB_POOL_MIN_IDLE", "1");
        values.put("DB_POOL_CONNECTION_TIMEOUT_MS", "5000"); values.put("DB_POOL_MAX_LIFETIME_MS", "180000");
        values.put("FORWARD_HEADERS_STRATEGY", "framework");
        try (var app=new SpringApplicationBuilder(Probe.class).profiles("azure").web(WebApplicationType.NONE).run(args(values))) {
            var pool=Binder.get(app.getEnvironment()).bind("spring.datasource.hikari", HikariConfig.class).orElseThrow(() -> new AssertionError("Missing Hikari configuration"));
            assertEquals(6,pool.getMaximumPoolSize()); assertEquals(1,pool.getMinimumIdle());
            assertEquals(5000,pool.getConnectionTimeout()); assertEquals(180000,pool.getMaxLifetime());
            assertEquals(20000,pool.getLeakDetectionThreshold());
            assertEquals("framework",app.getEnvironment().getProperty("server.forward-headers-strategy"));
        }
    }

    @Test void cannotActivateLocalSandboxOrReplaceSharedStoresInAzure() {
        for (var entry : Map.of("researchhub.analysis.sandbox.enabled", "true", "researchhub.auth.session-store", "servlet",
                "researchhub.security.quotas.store", "memory", "researchhub.sources.storage.adapter", "in-memory").entrySet()) {
            var values=valid(); values.put(entry.getKey(),entry.getValue());
            assertThrows(Exception.class, () -> new SpringApplicationBuilder(Probe.class).profiles("azure")
                .web(WebApplicationType.NONE).run(args(values)));
        }
        var values=valid(); values.put("ANALYSIS_SANDBOX_ENABLED","true");
        assertTrue(messages(assertThrows(Exception.class, () -> new SpringApplicationBuilder(Probe.class).profiles("azure")
            .web(WebApplicationType.NONE).run(args(values)))).contains("ANALYSIS_SANDBOX_ENABLED"));
    }

    @Test void rejectsMixedProfilesAndShortOrPaddedTokensWithoutLeakingValues() {
        var failure=assertThrows(Exception.class, () -> new SpringApplicationBuilder(Probe.class).profiles("azure","local")
            .web(WebApplicationType.NONE).run(args(valid())));
        assertTrue(messages(failure).contains("cannot be combined"));
        for (String name : List.of("AI_WORKER_SERVICE_TOKEN","METRICS_SCRAPE_TOKEN")) for (String token : List.of("short-secret", " padded-secret".repeat(4))) {
            var values=valid(); values.put(name,token);
            failure=assertThrows(Exception.class, () -> new SpringApplicationBuilder(Probe.class).profiles("azure")
                .web(WebApplicationType.NONE).run(args(values)));
            assertTrue(messages(failure).contains(name)); assertFalse(messages(failure).contains(token));
        }
    }

    @Test void nonDeploymentProfilesNeedNoCloudVariablesAndManagedIdentityDoesNotNeedAConnectionString() {
        var guard=new CloudEnvironmentConfiguration();
        guard.postProcessEnvironment(new MockEnvironment().withProperty("spring.profiles.active","test"),null);
        var env=new MockEnvironment(); env.setActiveProfiles("azure");
        var values=new HashMap<String,Object>(valid()); values.remove("BLOB_CONNECTION_STRING"); values.put("BLOB_AUTH","managed-identity");
        values.put("researchhub.auth.session-store","jdbc"); values.put("researchhub.security.quotas.store","postgres");
        values.put("researchhub.sources.storage.adapter","azure-blob"); env.getPropertySources().addFirst(new MapPropertySource("fixture",values));
        guard.postProcessEnvironment(env,null);
        assertTrue(guard.getOrder()>org.springframework.boot.context.config.ConfigDataEnvironmentPostProcessor.ORDER);
    }

    private static String[] args(Map<String,String> values) {
        return values.entrySet().stream().map(e -> "--"+e.getKey()+"="+e.getValue()).toArray(String[]::new);
    }
    private static String messages(Throwable failure) {
        var text=new StringBuilder(); for(var current=failure;current!=null;current=current.getCause()) text.append(current.getMessage()).append('\n');
        return text.toString();
    }
}
