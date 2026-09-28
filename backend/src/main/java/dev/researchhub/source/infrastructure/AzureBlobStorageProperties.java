package dev.researchhub.source.infrastructure;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

/** Connection settings for the Azure Blob SDK-backed source storage adapter. */
@Validated
@ConfigurationProperties(prefix = "researchhub.sources.storage.azure-blob")
public record AzureBlobStorageProperties(
        @NotBlank String endpoint,
        @NotBlank String accountName,
        @NotBlank String accountKey,
        @NotBlank
        @Pattern(regexp = "^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$",
                message = "must be a valid Azure Blob container name")
        String containerName
) {
}
