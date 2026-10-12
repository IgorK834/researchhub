package dev.researchhub.shared.observability;

import java.io.IOException;
import java.util.Map;
import java.util.Properties;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.env.EnvironmentPostProcessor;
import org.springframework.core.Ordered;
import org.springframework.core.env.ConfigurableEnvironment;
import org.springframework.core.env.MapPropertySource;
import org.springframework.core.io.ClassPathResource;

/** Read the immutable build identity before logging starts; runtime input cannot replace the built SHA. */
public final class BuildIdentityEnvironmentPostProcessor implements EnvironmentPostProcessor, Ordered {
    @Override public int getOrder() { return Ordered.HIGHEST_PRECEDENCE + 21; }
    @Override public void postProcessEnvironment(ConfigurableEnvironment environment, SpringApplication application) {
        Properties properties = new Properties();
        try {
            var resource = new ClassPathResource("META-INF/build-info.properties");
            if (resource.exists()) try (var input = resource.getInputStream()) { properties.load(input); }
        } catch (IOException failure) { throw new IllegalStateException("Cannot read build identity", failure); }
        String commit = commit(properties.getProperty("build.commit"));
        environment.getPropertySources().addFirst(new MapPropertySource("immutableBuildIdentity",
                Map.of("researchhub.build-commit", commit)));
    }
    static String commit(String value) { return value != null && value.matches("[a-f0-9]{40}") ? value : "unknown"; }
}
