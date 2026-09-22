package dev.researchhub.config;

import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Profile;
import org.springframework.core.env.Environment;

@Profile("cloud")
@Configuration
@EnableConfigurationProperties(CloudEnvironmentProperties.class)
public class CloudEnvironmentConfiguration {

    public CloudEnvironmentConfiguration(Environment environment) {
        require("DB_URL", environment.getProperty("DB_URL"));
        require("BLOB_ENDPOINT", environment.getProperty("BLOB_ENDPOINT"));
    }

    private static void require(String name, String value) {
        if (value == null || value.isBlank()) {
            throw new IllegalStateException(name + " must be set when the cloud profile is active");
        }
    }

}
