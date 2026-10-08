package dev.researchhub.source.infrastructure;

import jakarta.validation.constraints.Pattern;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;
import org.springframework.validation.annotation.Validated;

/** Connection settings for the Azure Blob SDK-backed source storage adapter. */
@Validated
@ConfigurationProperties(prefix = "researchhub.sources.storage.azure-blob")
public record AzureBlobStorageProperties(
        String endpoint,
        String accountName,
        String accountKey,
        @Pattern(regexp = "^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$",
                message = "must be a valid Azure Blob container name")
        @DefaultValue("researchhub-sources") String containerName,
        @DefaultValue("true") boolean createContainer,
        @DefaultValue("false") boolean createContainerOnStartup
) {
    @Override public String toString() {
        return "AzureBlobStorageProperties[credentials=REDACTED]";
    }
}
