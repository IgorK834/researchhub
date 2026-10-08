package dev.researchhub.source.infrastructure;

import com.azure.storage.blob.BlobClient;
import com.azure.storage.blob.BlobContainerClient;
import com.azure.storage.blob.models.BlobHttpHeaders;
import com.azure.storage.blob.models.BlobRequestConditions;
import com.azure.storage.blob.models.BlobStorageException;
import com.azure.storage.blob.sas.BlobSasPermission;
import com.azure.storage.blob.sas.BlobServiceSasSignatureValues;
import com.azure.storage.common.sas.SasProtocol;
import com.azure.storage.blob.options.BlockBlobOutputStreamOptions;
import com.azure.storage.blob.specialized.BlobOutputStream;
import dev.researchhub.source.application.SourceStorage;
import dev.researchhub.source.application.StorageObjectNotFoundException;
import dev.researchhub.source.application.TemporaryReadAccess;
import dev.researchhub.source.domain.StorageKey;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.FilterOutputStream;
import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Azure Blob implementation of {@link SourceStorage}. The exact same Azure SDK client talks to local Azurite and
 * to Azure Blob Storage; only its endpoint and credential configuration change.
 *
 * <p>Local container creation is lazy by default, with optional startup creation. Cloud containers are
 * provisioned by infrastructure and this adapter never attempts to create them.
 */
public final class AzureBlobSourceStorage implements SourceStorage {

    private static final int COPY_BUFFER_BYTES = 64 * 1024;

    private final BlobContainerClient container;
    private final AtomicBoolean containerReady = new AtomicBoolean();
    private final boolean createContainer;
    private final boolean sharedKeySas;

    public AzureBlobSourceStorage(BlobContainerClient container) {
        this(container, true, true);
    }

    public AzureBlobSourceStorage(BlobContainerClient container, boolean createContainer, boolean sharedKeySas) {
        this.container = container;
        this.createContainer = createContainer;
        this.sharedKeySas = sharedKeySas;
    }

    @Override
    public void store(StorageKey key, InputStream content, String mediaType) throws IOException {
        ensureContainer();
        BlobClient blob = container.getBlobClient(key.value());
        BlockBlobOutputStreamOptions options = new BlockBlobOutputStreamOptions()
                .setHeaders(new BlobHttpHeaders().setContentType(mediaType))
                .setRequestConditions(new BlobRequestConditions().setIfNoneMatch("*"));

        try (OutputStream output = safeOutput(blob.getBlockBlobClient().getBlobOutputStream(options), key)) {
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
            throw new IOException("Azure Blob could not store " + key);
        }
    }

    @Override
    public InputStream open(StorageKey key) throws IOException {
        ensureContainer();
        try {
            return safeInput(container.getBlobClient(key.value()).openInputStream(), key);
        } catch (BlobStorageException failure) {
            if (failure.getStatusCode() == 404) {
                throw new StorageObjectNotFoundException(key);
            }
            throw storageFailure("open", key, failure);
        } catch (RuntimeException failure) {
            throw new IOException("Azure Blob could not open " + key);
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
            throw new IOException("Azure Blob could not inspect " + key);
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
            throw new IOException("Azure Blob could not delete " + key);
        }
    }

    @Override
    public Optional<TemporaryReadAccess> createTemporaryReadAccess(StorageKey key, Duration ttl) throws IOException {
        if (ttl == null || ttl.isZero() || ttl.isNegative()) {
            throw new IllegalArgumentException("temporary read access TTL must be positive");
        }
        // A token credential needs a user delegation key before it can sign worker read access (Task 21.17).
        if (!sharedKeySas) return Optional.empty();
        ensureContainer();
        BlobClient blob = container.getBlobClient(key.value());
        Instant now = Instant.now();
        Instant expiresAt = now.plus(ttl);
        BlobServiceSasSignatureValues values = new BlobServiceSasSignatureValues(
                OffsetDateTime.ofInstant(expiresAt, ZoneOffset.UTC),
                new BlobSasPermission().setReadPermission(true))
                .setStartTime(OffsetDateTime.ofInstant(now.minusSeconds(30), ZoneOffset.UTC))
                .setProtocol(blob.getBlobUrl().startsWith("https://") ? SasProtocol.HTTPS_ONLY : SasProtocol.HTTPS_HTTP);
        try {
            String sas = blob.generateSas(values);
            return Optional.of(new TemporaryReadAccess(java.net.URI.create(blob.getBlobUrl() + "?" + sas),
                    expiresAt));
        } catch (BlobStorageException failure) {
            throw storageFailure("authorize", key, failure);
        } catch (RuntimeException failure) {
            throw new IOException("Azure Blob could not authorize " + key);
        }
    }

    private void ensureContainer() throws IOException {
        if (!createContainer || containerReady.get()) {
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
                throw new IOException("Azure Blob container could not be created or reached (" + failure.getClass().getName() + ")");
            } catch (RuntimeException failure) {
                throw new IOException("Azure Blob container could not be created or reached (" + failure.getClass().getName() + ")");
            }
        }
    }

    public void initializeContainer() throws IOException {
        ensureContainer();
    }

    // SDK streams fail lazily too; their diagnostics can contain signed URLs. Sanitize at the I/O boundary.
    private static InputStream safeInput(InputStream input, StorageKey key) {
        return new InputStream() {
            @Override public int read() throws IOException {
                try { return input.read(); }
                catch (IOException | RuntimeException failure) { throw streamFailure("open", key); }
            }
            @Override public int read(byte[] buffer, int offset, int length) throws IOException {
                try { return input.read(buffer, offset, length); }
                catch (IOException | RuntimeException failure) { throw streamFailure("open", key); }
            }
            @Override public void close() throws IOException {
                try { input.close(); }
                catch (IOException | RuntimeException failure) { throw streamFailure("close", key); }
            }
        };
    }

    private static OutputStream safeOutput(BlobOutputStream output, StorageKey key) {
        return new FilterOutputStream(output) {
            @Override public void write(byte[] buffer, int offset, int length) throws IOException {
                try { out.write(buffer, offset, length); }
                catch (IOException | RuntimeException failure) { throw streamFailure("store", key); }
            }
            @Override public void close() throws IOException {
                try { out.close(); }
                catch (IOException | RuntimeException failure) { throw streamFailure("close", key); }
            }
        };
    }

    private static IOException streamFailure(String operation, StorageKey key) {
        return new IOException("Azure Blob could not " + operation + " " + key);
    }

    private static IOException storageFailure(String operation, StorageKey key, BlobStorageException failure) {
        return new IOException("Azure Blob could not " + operation + " " + key
                + " (status " + failure.getStatusCode() + ")");
    }

}
