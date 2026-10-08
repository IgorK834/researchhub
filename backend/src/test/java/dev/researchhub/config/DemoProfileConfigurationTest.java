package dev.researchhub.config;

import org.junit.jupiter.api.Test;
import org.springframework.context.annotation.Configuration;
import org.springframework.boot.WebApplicationType;
import org.springframework.boot.builder.SpringApplicationBuilder;
import static org.junit.jupiter.api.Assertions.*;

class DemoProfileConfigurationTest {
    @Configuration(proxyBeanMethods=false) static class Probe {}
    @Test void demoAloneInheritsLocalInfrastructureAndAppliesEveryOverride() {
        try (var context = new SpringApplicationBuilder(Probe.class).web(WebApplicationType.NONE).profiles("demo").run("--spring.main.banner-mode=off")) {
            var env = context.getEnvironment();
            assertTrue(java.util.Arrays.asList(env.getActiveProfiles()).contains("local"));
            var expected = java.util.Map.ofEntries(
                java.util.Map.entry("researchhub.environment","demo"),java.util.Map.entry("server.servlet.session.cookie.secure","true"),java.util.Map.entry("server.forward-headers-strategy","framework"),
                java.util.Map.entry("researchhub.auth.registration.mode","disabled"),java.util.Map.entry("researchhub.sources.max-size-bytes","10485760"),
                java.util.Map.entry("spring.servlet.multipart.max-file-size","10485760B"),java.util.Map.entry("spring.servlet.multipart.max-request-size","11534336B"),
                java.util.Map.entry("researchhub.security.quotas.window","PT1H"),java.util.Map.entry("researchhub.security.quotas.llm.user","10"),
                java.util.Map.entry("researchhub.security.quotas.llm.workspace","30"),java.util.Map.entry("researchhub.security.quotas.analysis.user","3"),
                java.util.Map.entry("researchhub.security.quotas.analysis.workspace","10"),java.util.Map.entry("researchhub.security.quotas.retrieval.user","60"),
                java.util.Map.entry("researchhub.security.quotas.retrieval.workspace","180"),java.util.Map.entry("researchhub.collaboration.enabled","true"),
                java.util.Map.entry("researchhub.collaboration.websocket-url","wss://localhost:8443/collaboration"),
                java.util.Map.entry("researchhub.auth.session-store","jdbc"),java.util.Map.entry("researchhub.security.quotas.store","postgres"));
            expected.forEach((key,value) -> assertEquals(value,env.getProperty(key),key));
            assertNull(env.getProperty("researchhub.auth.cors.allowed-origins[0]"));
            assertEquals(java.util.List.of(), org.springframework.boot.context.properties.bind.Binder.get(env).bind("researchhub.auth.cors.allowed-origins",org.springframework.boot.context.properties.bind.Bindable.listOf(String.class)).get());
        }
    }
}
