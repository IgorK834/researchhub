package dev.researchhub.analysis.infrastructure;

import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Profile;
import dev.researchhub.analysis.application.SandboxRunner;
import tools.jackson.databind.ObjectMapper;
import java.util.Map;

@Configuration(proxyBeanMethods = false)
@EnableConfigurationProperties(SandboxProperties.class)
class SandboxConfiguration {
    @Bean
    @Profile("local & !azure")
    DockerSandboxRunner dockerSandboxRunner(SandboxProperties properties, ObjectMapper json) {
        return new DockerSandboxRunner(properties, json);
    }

    /** No host process is launched outside local; the durable API records the existing safe failure code. */
    @Bean
    @Profile("!local | azure")
    SandboxRunner unavailableSandboxRunner() {
        return request -> new SandboxRunner.Result(false, "SANDBOX_UNAVAILABLE", null, false,
                "", "", false, false, null, null, Map.of());
    }
}
