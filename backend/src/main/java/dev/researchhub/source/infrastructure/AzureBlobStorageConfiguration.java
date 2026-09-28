package dev.researchhub.source.infrastructure;

import com.azure.storage.blob.BlobContainerClient;
import com.azure.storage.blob.BlobServiceClientBuilder;
import com.azure.storage.common.StorageSharedKeyCredential;
import dev.researchhub.source.application.SourceStorage;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Profile;

/** Wires the Azure Blob SDK to Azurite for the local profile. */
@Configuration(proxyBeanMethods = false)
@Profile("local")
@ConditionalOnProperty(prefix = "researchhub.sources.storage", name = "adapter", havingValue = "azure-blob")
@EnableConfigurationProperties(AzureBlobStorageProperties.class)
public class AzureBlobStorageConfiguration {

    @Bean
    BlobContainerClient sourceBlobContainerClient(AzureBlobStorageProperties properties) {
        StorageSharedKeyCredential credential = new StorageSharedKeyCredential(
                properties.accountName(), properties.accountKey());

        return new BlobServiceClientBuilder()
                .endpoint(properties.endpoint())
                .credential(credential)
                .buildClient()
                .getBlobContainerClient(properties.containerName());
    }

    @Bean
    SourceStorage azureBlobSourceStorage(BlobContainerClient container) {
        return new AzureBlobSourceStorage(container);
    }

}
