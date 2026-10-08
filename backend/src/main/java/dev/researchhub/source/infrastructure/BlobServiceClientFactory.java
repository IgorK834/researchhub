package dev.researchhub.source.infrastructure;

import com.azure.storage.blob.BlobServiceClient;

/** Credential seam; Task 21.17 supplies a managed-identity implementation without changing SourceStorage. */
@FunctionalInterface
public interface BlobServiceClientFactory {
    BlobServiceClient create(AzureBlobStorageProperties storage, AzureBlobAuthenticationProperties authentication);
}
