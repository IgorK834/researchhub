package dev.researchhub.config;

import jakarta.validation.constraints.NotBlank;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

@Validated
@ConfigurationProperties(prefix = "researchhub.cloud")
public record CloudEnvironmentProperties(
        @NotBlank(message = "DB_URL must be set when the cloud profile is active") String dbUrl,
        @NotBlank(message = "BLOB_ENDPOINT must be set when the cloud profile is active") String blobEndpoint
) {
}
