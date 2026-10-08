package dev.researchhub.source.infrastructure;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;

/** Credentials are deliberately not included in validation diagnostics or record rendering. */
@ConfigurationProperties(prefix = "researchhub.sources.storage.azure")
public record AzureBlobAuthenticationProperties(
        @DefaultValue("connection-string") String auth, String connectionString) {
    @Override public String toString() {
        return "AzureBlobAuthenticationProperties[credentials=REDACTED]";
    }
}
