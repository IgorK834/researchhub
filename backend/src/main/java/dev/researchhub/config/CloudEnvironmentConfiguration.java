package dev.researchhub.config;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.env.EnvironmentPostProcessor;
import org.springframework.boot.context.config.ConfigDataEnvironmentPostProcessor;
import org.springframework.core.Ordered;
import org.springframework.core.env.ConfigurableEnvironment;
import org.springframework.core.env.Profiles;

/** Validates the deployment contract before any datasource, SDK client or product bean is created. */
public class CloudEnvironmentConfiguration implements EnvironmentPostProcessor, Ordered {
    @Override
    public int getOrder() {
        return ConfigDataEnvironmentPostProcessor.ORDER + 1;
    }

    @Override
    public void postProcessEnvironment(ConfigurableEnvironment environment, SpringApplication application) {
        if (!environment.acceptsProfiles(Profiles.of("azure", "cloud"))) return;
        for (String name : new String[]{"DB_URL", "DB_USER", "DB_PASSWORD", "BLOB_ENDPOINT",
                "AI_WORKER_BASE_URL", "AI_WORKER_SERVICE_TOKEN", "METRICS_SCRAPE_TOKEN"}) {
            require(name, environment.getProperty(name));
        }
        if ("connection-string".equals(environment.getProperty("BLOB_AUTH", "connection-string"))) {
            require("BLOB_CONNECTION_STRING", environment.getProperty("BLOB_CONNECTION_STRING"));
        }
        for (String name : new String[]{"AI_WORKER_SERVICE_TOKEN", "METRICS_SCRAPE_TOKEN"}) {
            String value = environment.getProperty(name);
            if (value.length() < 32 || !value.equals(value.strip())) {
                throw new IllegalStateException(name + " must contain at least 32 characters without surrounding whitespace");
            }
        }
        if (environment.acceptsProfiles(Profiles.of("local", "test"))) {
            throw new IllegalStateException("The azure/cloud profile cannot be combined with local or test");
        }
        requiredSelection(environment, "researchhub.auth.session-store", "jdbc");
        requiredSelection(environment, "researchhub.security.quotas.store", "postgres");
        requiredSelection(environment, "researchhub.sources.storage.adapter", "azure-blob");
        if (environment.getProperty("researchhub.analysis.sandbox.enabled", Boolean.class, false)) {
            throw new IllegalStateException("ANALYSIS_SANDBOX_ENABLED must be false until an Azure sandbox runner exists");
        }
    }

    private static void requiredSelection(ConfigurableEnvironment environment, String name, String expected) {
        if (!expected.equals(environment.getProperty(name))) {
            throw new IllegalStateException(name + " must be " + expected + " when the azure/cloud profile is active");
        }
    }

    private static void require(String name, String value) {
        if (value == null || value.isBlank()) {
            throw new IllegalStateException(name + " must be set when the azure/cloud profile is active");
        }
    }
}
