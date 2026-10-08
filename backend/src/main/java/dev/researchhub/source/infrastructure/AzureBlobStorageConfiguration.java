package dev.researchhub.source.infrastructure;

import com.azure.storage.blob.BlobContainerClient;
import com.azure.storage.blob.BlobServiceClient;
import dev.researchhub.source.application.SourceStorage;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Profile;
import org.springframework.core.env.Environment;
import org.springframework.core.env.Profiles;
import java.io.IOException;

/** The same adapter serves Azurite and Azure; profiles supply endpoint and credential settings. */
@Configuration(proxyBeanMethods = false)
@Profile({"local", "demo", "azure"})
@ConditionalOnProperty(prefix = "researchhub.sources.storage", name = "adapter", havingValue = "azure-blob")
@EnableConfigurationProperties({AzureBlobStorageProperties.class, AzureBlobAuthenticationProperties.class})
public class AzureBlobStorageConfiguration {

    @Bean
    @ConditionalOnMissingBean(BlobServiceClientFactory.class)
    BlobServiceClientFactory blobServiceClientFactory() {
        return new KeyBasedBlobServiceClientFactory();
    }

    @Bean
    BlobServiceClient sourceBlobServiceClient(AzureBlobStorageProperties properties,
            AzureBlobAuthenticationProperties authentication, BlobServiceClientFactory factory, Environment environment) {
        if (environment.acceptsProfiles(Profiles.of("azure"))) {
            String endpoint = environment.getProperty("BLOB_ENDPOINT");
            if (endpoint == null || endpoint.isBlank()) {
                throw new IllegalStateException("BLOB_ENDPOINT must be set when the azure profile is active");
            }
            KeyBasedBlobServiceClientFactory.validateEndpoint(endpoint);
            if (!endpoint.startsWith("https://") || !endpoint.equals(properties.endpoint())) {
                throw new IllegalStateException("The azure profile requires BLOB_ENDPOINT as its HTTPS service endpoint");
            }
            if (properties.createContainer() || properties.createContainerOnStartup()) {
                throw new IllegalStateException("Azure Blob containers must be provisioned by infrastructure in the azure profile");
            }
            if ("connection-string".equals(authentication.auth())
                    && (authentication.connectionString() == null || authentication.connectionString().isBlank())) {
                throw new IllegalStateException("BLOB_CONNECTION_STRING is required for Azure Blob connection-string auth");
            }
        }
        return factory.create(properties, authentication);
    }

    @Bean
    BlobContainerClient sourceBlobContainerClient(BlobServiceClient service, AzureBlobStorageProperties properties) {
        return service.getBlobContainerClient(properties.containerName());
    }

    @Bean
    SourceStorage azureBlobSourceStorage(BlobContainerClient container, AzureBlobStorageProperties properties,
            AzureBlobAuthenticationProperties authentication) throws IOException {
        var storage = new AzureBlobSourceStorage(container, properties.createContainer(),
                "connection-string".equals(authentication.auth()));
        if (properties.createContainerOnStartup()) storage.initializeContainer();
        return storage;
    }

}
