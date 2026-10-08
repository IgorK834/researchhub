package dev.researchhub.source.infrastructure;

import com.azure.storage.blob.BlobServiceClient;
import com.azure.storage.blob.BlobServiceClientBuilder;
import com.azure.storage.common.StorageSharedKeyCredential;
import java.net.URI;

final class KeyBasedBlobServiceClientFactory implements BlobServiceClientFactory {
    @Override
    public BlobServiceClient create(AzureBlobStorageProperties storage, AzureBlobAuthenticationProperties authentication) {
        validateEndpoint(storage.endpoint());
        if ("managed-identity".equals(authentication.auth())) {
            throw new IllegalStateException("Managed identity requires the BlobServiceClientFactory from Task 21.17");
        }
        if (!"connection-string".equals(authentication.auth())) {
            throw new IllegalArgumentException("Azure Blob auth must be connection-string or managed-identity");
        }
        try {
            var builder = new BlobServiceClientBuilder();
            if (authentication.connectionString() != null && !authentication.connectionString().isBlank()) {
                // Service SAS requires an account key; SAS-only connection strings cannot sign worker access.
                StorageSharedKeyCredential.fromConnectionString(authentication.connectionString());
                builder.connectionString(authentication.connectionString());
            } else {
                if (storage.accountName() == null || storage.accountName().isBlank()
                        || storage.accountKey() == null || storage.accountKey().isBlank()) {
                    throw new IllegalArgumentException();
                }
                builder.credential(new StorageSharedKeyCredential(storage.accountName(), storage.accountKey()));
            }
            // BLOB_ENDPOINT is authoritative, including when the connection string contains an endpoint.
            return builder.endpoint(storage.endpoint()).buildClient();
        } catch (RuntimeException failure) {
            // SDK parsing failures can contain a connection string, key or signed URL. Do not retain the cause.
            throw new IllegalArgumentException("Azure Blob key-based credentials are missing or invalid");
        }
    }

    static void validateEndpoint(String endpoint) {
        try {
            URI uri = URI.create(endpoint);
            if (!uri.isAbsolute() || uri.getHost() == null || uri.getUserInfo() != null || uri.getQuery() != null
                    || uri.getFragment() != null || !("https".equals(uri.getScheme()) || "http".equals(uri.getScheme()))) {
                throw new IllegalArgumentException();
            }
        } catch (RuntimeException failure) {
            throw new IllegalArgumentException("Azure Blob endpoint must be an HTTP(S) service URL without credentials");
        }
    }
}
