package dev.researchhub.source.infrastructure;

import com.azure.storage.blob.BlobClient;
import com.azure.storage.blob.BlobContainerClient;
import com.azure.storage.blob.models.BlobHttpHeaders;
import com.azure.storage.blob.models.BlobRequestConditions;
import com.azure.storage.blob.models.BlobStorageException;
import com.azure.storage.blob.options.BlockBlobOutputStreamOptions;
import com.azure.storage.blob.specialized.BlobOutputStream;
import dev.researchhub.source.application.SourceStorage;
import dev.researchhub.source.application.StorageObjectNotFoundException;
import dev.researchhub.source.application.TemporaryReadAccess;
import dev.researchhub.source.domain.StorageKey;

import java.io.IOException;
import java.io.InputStream;
import java.time.Duration;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Azure Blob implementation of {@link SourceStorage}. The exact same Azure SDK client talks to local Azurite and
 * to Azure Blob Storage; only its endpoint and credential configuration change.
 *
 * <p>The container is created on the first operation. That keeps application startup and unrelated local tests
 * independent of Azurite, while a first real upload still provisions the one required private container
 * automatically. A named Docker volume makes the emulator's data survive container restarts.
 */
public final class AzureBlobSourceStorage implements SourceStorage {

    private static final int COPY_BUFFER_BYTES = 64 * 1024;

    private final BlobContainerClient container;
    private final AtomicBoolean containerReady = new AtomicBoolean();

    public AzureBlobSourceStorage(BlobContainerClient container) {
        this.container = container;
    }

    @Override
    public void store(StorageKey key, InputStream content, String mediaType) throws IOException {
        ensureContainer();
        BlobClient blob = container.getBlobClient(key.value());
        BlockBlobOutputStreamOptions options = new BlockBlobOutputStreamOptions()
                .setHeaders(new BlobHttpHeaders().setContentType(mediaType))
                .setRequestConditions(new BlobRequestConditions().setIfNoneMatch("*"));

        try (BlobOutputStream output = blob.getBlockBlobClient().getBlobOutputStream(options)) {
            byte[] buffer = new byte[COPY_BUFFER_BYTES];
            int read;
            while ((read = content.read(buffer)) != -1) {
                output.write(buffer, 0, read);
            }
        } catch (IOException failure) {
            throw failure;
        } catch (BlobStorageException failure) {
            throw storageFailure("store", key, failure);
        } catch (RuntimeException failure) {
            throw new IOException("Azure Blob could not store " + key, failure);
        }
    }

    @Override
    public InputStream open(StorageKey key) throws IOException {
        ensureContainer();
        try {
            return container.getBlobClient(key.value()).openInputStream();
        } catch (BlobStorageException failure) {
            if (failure.getStatusCode() == 404) {
                throw new StorageObjectNotFoundException(key);
            }
            throw storageFailure("open", key, failure);
        } catch (RuntimeException failure) {
            throw new IOException("Azure Blob could not open " + key, failure);
        }
    }

    @Override
    public boolean exists(StorageKey key) throws IOException {
        ensureContainer();
        try {
            return container.getBlobClient(key.value()).exists();
        } catch (BlobStorageException failure) {
            throw storageFailure("inspect", key, failure);
        } catch (RuntimeException failure) {
            throw new IOException("Azure Blob could not inspect " + key, failure);
        }
    }

    @Override
    public void delete(StorageKey key) throws IOException {
        ensureContainer();
        try {
            container.getBlobClient(key.value()).deleteIfExists();
        } catch (BlobStorageException failure) {
            throw storageFailure("delete", key, failure);
        } catch (RuntimeException failure) {
            throw new IOException("Azure Blob could not delete " + key, failure);
        }
    }

    @Override
    public Optional<TemporaryReadAccess> createTemporaryReadAccess(StorageKey key, Duration ttl) {
        // ResearchHub streams authorized downloads through its API. A cloud profile may enable single-blob SAS
        // later without changing the port or exposing storage credentials to the browser.
        return Optional.empty();
    }

    private void ensureContainer() throws IOException {
        if (containerReady.get()) {
            return;
        }
        synchronized (containerReady) {
            if (containerReady.get()) {
                return;
            }
            try {
                container.createIfNotExists();
                containerReady.set(true);
            } catch (BlobStorageException failure) {
                throw new IOException("Azure Blob container could not be created or reached", failure);
            } catch (RuntimeException failure) {
                throw new IOException("Azure Blob container could not be created or reached", failure);
            }
        }
    }

    private static IOException storageFailure(String operation, StorageKey key, BlobStorageException failure) {
        return new IOException("Azure Blob could not " + operation + " " + key
                + " (status " + failure.getStatusCode() + ")", failure);
    }

}
