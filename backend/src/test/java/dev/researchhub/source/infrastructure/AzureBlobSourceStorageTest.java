package dev.researchhub.source.infrastructure;

import com.azure.core.http.HttpResponse;
import com.azure.storage.blob.*;
import com.azure.storage.blob.models.BlobStorageException;
import com.azure.storage.blob.specialized.BlockBlobClient;
import dev.researchhub.source.application.StorageObjectNotFoundException;
import dev.researchhub.source.domain.StorageKey;
import java.io.*;
import java.time.Duration;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class AzureBlobSourceStorageTest {
    private static final String SECRET = "AccountKey=must-not-leak;sig=must-not-leak";
    private final BlobContainerClient container = mock(BlobContainerClient.class);
    private final BlobClient blob = mock(BlobClient.class);
    private final StorageKey key = StorageKey.generate();

    @Test void provisionedCloudContainerIsNeverCreatedAndManagedIdentityCannotSignServiceSas() throws Exception {
        when(container.getBlobClient(key.value())).thenReturn(blob);
        when(blob.exists()).thenReturn(true);
        var storage = new AzureBlobSourceStorage(container, false, false);
        storage.initializeContainer(); assertTrue(storage.exists(key));
        storage.delete(key);
        assertTrue(storage.createTemporaryReadAccess(key, Duration.ofMinutes(1)).isEmpty());
        verify(container, never()).createIfNotExists();
        verify(blob, never()).generateSas(any());
    }

    @Test void invalidSasTtlFailsBeforeAnyStorageCall() {
        var storage = new AzureBlobSourceStorage(container);
        for (Duration ttl : new Duration[]{null, Duration.ZERO, Duration.ofSeconds(-1)})
            assertThrows(IllegalArgumentException.class, () -> storage.createTemporaryReadAccess(key, ttl));
        verifyNoInteractions(container);
    }

    @Test void startupCreationIsIdempotentAndFailureIsSafeAndRetryable() throws Exception {
        when(container.createIfNotExists()).thenThrow(new IllegalArgumentException(SECRET)).thenReturn(true);
        var storage = new AzureBlobSourceStorage(container);
        safe(assertThrows(IOException.class, storage::initializeContainer));
        storage.initializeContainer(); storage.initializeContainer();
        verify(container, times(2)).createIfNotExists();
    }

    @Test void sdkFailuresNeverExposeCredentialMessagesOrCauses() {
        when(container.getBlobClient(key.value())).thenReturn(blob);
        var block = mock(BlockBlobClient.class);
        when(blob.getBlockBlobClient()).thenReturn(block);
        when(blob.getBlobUrl()).thenReturn("https://account.blob.core.windows.net/container/object");
        var storage = new AzureBlobSourceStorage(container, false, true);
        for (RuntimeException failure : new RuntimeException[]{new IllegalStateException(SECRET), storageFailure(403)}) {
            doThrow(failure).when(blob).openInputStream();
            doThrow(failure).when(blob).exists();
            doThrow(failure).when(blob).deleteIfExists();
            doThrow(failure).when(blob).generateSas(any());
            doThrow(failure).when(block).getBlobOutputStream(any(com.azure.storage.blob.options.BlockBlobOutputStreamOptions.class));
            safe(assertThrows(IOException.class, () -> storage.open(key)));
            safe(assertThrows(IOException.class, () -> storage.exists(key)));
            safe(assertThrows(IOException.class, () -> storage.delete(key)));
            safe(assertThrows(IOException.class, () -> storage.createTemporaryReadAccess(key, Duration.ofMinutes(1))));
            safe(assertThrows(IOException.class, () -> storage.store(key, new ByteArrayInputStream(new byte[]{1}), "text/plain")));
        }
    }

    @Test void missingObjectKeepsTheStoragePortErrorAndContainerSdkErrorIsSafe() {
        when(container.getBlobClient(key.value())).thenReturn(blob);
        var missing = storageFailure(404);
        when(blob.openInputStream()).thenThrow(missing);
        assertThrows(StorageObjectNotFoundException.class, () -> new AzureBlobSourceStorage(container, false, true).open(key));
        var forbidden = storageFailure(403);
        when(container.createIfNotExists()).thenThrow(forbidden);
        safe(assertThrows(IOException.class, () -> new AzureBlobSourceStorage(container).initializeContainer()));
    }

    @Test void lazySdkReadWriteAndCloseFailuresAreAlsoSanitized() throws Exception {
        when(container.getBlobClient(key.value())).thenReturn(blob);
        var sdkInput = mock(com.azure.storage.blob.specialized.BlobInputStream.class);
        when(sdkInput.read()).thenThrow(new IOException(SECRET));
        when(sdkInput.read(any(byte[].class), anyInt(), anyInt())).thenThrow(new IllegalStateException(SECRET));
        doThrow(new IOException(SECRET)).when(sdkInput).close();
        when(blob.openInputStream()).thenReturn(sdkInput);
        var storage = new AzureBlobSourceStorage(container, false, true);
        InputStream safe = storage.open(key);
        safe(assertThrows(IOException.class, safe::read));
        safe(assertThrows(IOException.class, () -> safe.read(new byte[10])));
        safe(assertThrows(IOException.class, safe::close));

        var block = mock(BlockBlobClient.class);
        var output = mock(com.azure.storage.blob.specialized.BlobOutputStream.class);
        when(blob.getBlockBlobClient()).thenReturn(block);
        when(block.getBlobOutputStream(any(com.azure.storage.blob.options.BlockBlobOutputStreamOptions.class))).thenReturn(output);
        doThrow(new IOException(SECRET)).when(output).write(any(byte[].class), anyInt(), anyInt());
        safe(assertThrows(IOException.class, () -> storage.store(key, new ByteArrayInputStream(new byte[]{1}), "text/plain")));
        doNothing().when(output).write(any(byte[].class), anyInt(), anyInt());
        doThrow(new IllegalStateException(SECRET)).when(output).close();
        safe(assertThrows(IOException.class, () -> storage.store(key, new ByteArrayInputStream(new byte[0]), "text/plain")));
    }

    private static BlobStorageException storageFailure(int status) {
        HttpResponse response = mock(HttpResponse.class);
        when(response.getStatusCode()).thenReturn(status);
        return new BlobStorageException(SECRET, response, null);
    }
    private static void safe(IOException failure) {
        assertFalse(failure.toString().contains("must-not-leak"));
        assertNull(failure.getCause()); assertEquals(0, failure.getSuppressed().length);
    }
}
