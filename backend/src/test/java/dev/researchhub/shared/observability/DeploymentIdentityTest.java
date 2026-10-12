package dev.researchhub.shared.observability;

import java.util.Properties;
import org.flywaydb.core.Flyway;
import org.flywaydb.core.api.MigrationInfo;
import org.flywaydb.core.api.MigrationInfoService;
import org.flywaydb.core.api.MigrationVersion;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.support.StaticListableBeanFactory;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.actuate.info.Info;
import org.springframework.boot.info.BuildProperties;
import org.springframework.mock.env.MockEnvironment;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class DeploymentIdentityTest {
    private static final String SHA = "a".repeat(40), DIGEST = "sha256:" + "b".repeat(64);
    private static <T> ObjectProvider<T> provider(Class<T> type, T value) {
        var beans = new StaticListableBeanFactory(); if (value != null) beans.addBean("value", value);
        return beans.getBeanProvider(type);
    }
    private static BuildProperties build(boolean time) {
        var values = new Properties(); values.setProperty("commit", SHA);
        if (time) values.setProperty("time", "2026-10-12T10:00:00Z");
        return new BuildProperties(values);
    }
    private static DeploymentInfoContributor info(BuildProperties build, Flyway flyway, String commit, String digest, String expected, boolean required) {
        return new DeploymentInfoContributor(provider(BuildProperties.class, build), provider(Flyway.class, flyway), commit, "replica-1", digest, expected, required);
    }
    @Test void buildIdentityIsBoundedAndCannotBeOverriddenByRuntimeProperties() {
        for (String input : new String[]{"", "unknown", "A".repeat(40), "bad\nidentity"}) assertEquals("unknown", BuildIdentityEnvironmentPostProcessor.commit(input));
        assertEquals("unknown", BuildIdentityEnvironmentPostProcessor.commit(null));
        assertEquals(SHA, BuildIdentityEnvironmentPostProcessor.commit(SHA));
        var environment = new MockEnvironment().withProperty("researchhub.build-commit", "untrusted-runtime-sha");
        var processor = new BuildIdentityEnvironmentPostProcessor(); processor.postProcessEnvironment(environment, new SpringApplication());
        assertNotEquals("untrusted-runtime-sha", environment.getProperty("researchhub.build-commit"));
        assertTrue(processor.getOrder() < 0);
    }
    @Test void reportsActualLatestMigrationAndBuildTimeWithoutCredentials() {
        var flyway = mock(Flyway.class); var service = mock(MigrationInfoService.class); var current = mock(MigrationInfo.class);
        when(flyway.info()).thenReturn(service); when(service.current()).thenReturn(current); when(current.getVersion()).thenReturn(MigrationVersion.fromVersion("44"));
        var builder = new Info.Builder(); info(build(true), flyway, SHA, DIGEST, SHA, true).contribute(builder);
        var detail = (java.util.Map<?, ?>) builder.build().getDetails().get("deployment");
        assertEquals(SHA, detail.get("commit")); assertEquals(DIGEST, detail.get("imageDigest")); assertEquals("44", detail.get("flywayVersion"));
        assertEquals("2026-10-12T10:00:00Z", detail.get("buildTime")); assertEquals("replica-1", detail.get("instanceId"));
        assertEquals(5, detail.size());
        when(current.getVersion()).thenReturn(null); var empty = new Info.Builder(); info(build(false), flyway, SHA, "", "", false).contribute(empty);
        assertTrue(empty.build().getDetails().toString().contains("none"));
        when(service.current()).thenReturn(null); info(null, flyway, "unknown", "", "", false).contribute(new Info.Builder());
        info(null, null, "unknown", "", "", false).contribute(new Info.Builder());
    }
    @Test void strictDeploymentsRejectMissingAndMismatchedIdentity() {
        assertThrows(IllegalStateException.class, () -> info(build(true), null, SHA, "bad", SHA, true));
        assertThrows(IllegalStateException.class, () -> info(build(true), null, SHA, DIGEST, "c".repeat(40), false));
        assertThrows(IllegalStateException.class, () -> info(build(true), null, "unknown", DIGEST, "unknown", true));
        assertThrows(IllegalStateException.class, () -> info(build(true), null, SHA, "", SHA, true));
        assertThrows(IllegalStateException.class, () -> info(build(true), null, SHA, DIGEST, "", true));
        assertThrows(IllegalStateException.class, () -> info(null, null, SHA, DIGEST, SHA, true));
        assertThrows(IllegalStateException.class, () -> info(build(false), null, SHA, DIGEST, SHA, true));
    }
    @Test void providerUnavailableCounterExistsEvenInAHealthyStagingWindow() {
        var registry = new io.micrometer.core.instrument.simple.SimpleMeterRegistry(); var metrics = new WorkMetrics(registry);
        assertEquals(0, registry.get("researchhub.ai.provider.unavailable").counter().count());
        metrics.providerUnavailable(); assertEquals(1, registry.get("researchhub.ai.provider.unavailable").counter().count());
        assertEquals(0, registry.get("researchhub.worker.failures").tag("queue", "SOURCE_INGEST").counter().count());
    }
}
