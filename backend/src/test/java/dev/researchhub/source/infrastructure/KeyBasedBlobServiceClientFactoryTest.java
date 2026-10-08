package dev.researchhub.source.infrastructure;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class KeyBasedBlobServiceClientFactoryTest {
    private final KeyBasedBlobServiceClientFactory factory = new KeyBasedBlobServiceClientFactory();
    private static final String SECRET = "should-never-appear-in-diagnostics";
    private static AzureBlobStorageProperties storage(String endpoint, String account, String key) {
        return new AzureBlobStorageProperties(endpoint, account, key, "researchhub-sources", false, false);
    }

    @Test void invalidEndpointsNeverExposeSignedUrls() {
        for (String endpoint : new String[]{"", "not-a-url", "ftp://host", "https://host?sig=" + SECRET,
                "https://user:" + SECRET + "@host", "https://host#" + SECRET}) {
            var failure = assertThrows(IllegalArgumentException.class, () -> factory.create(storage(endpoint, "account", SECRET),
                    new AzureBlobAuthenticationProperties("connection-string", null)));
            assertFalse(failure.toString().contains(SECRET)); assertNull(failure.getCause());
        }
    }
    @Test void invalidCredentialsAndStrategiesHaveSafeErrors() {
        for (String connection : new String[]{SECRET, " ", "SharedAccessSignature=" + SECRET}) {
            var failure = assertThrows(IllegalArgumentException.class, () -> factory.create(storage("https://host", null, null),
                    new AzureBlobAuthenticationProperties("connection-string", connection)));
            assertFalse(failure.toString().contains(SECRET)); assertNull(failure.getCause());
        }
        assertThrows(IllegalArgumentException.class, () -> factory.create(storage("https://host", "account", SECRET),
                new AzureBlobAuthenticationProperties("unknown", null)));
        assertFalse(storage("https://host", "account", SECRET).toString().contains(SECRET));
        assertFalse(new AzureBlobAuthenticationProperties("connection-string", SECRET).toString().contains(SECRET));
    }
    @Test void keyBasedClientCanSignAReadOnlyCloudSasWithoutNetworkAccess() throws Exception {
        var client = factory.create(storage("https://account.blob.core.windows.net", "account", "YWJjZA=="),
                new AzureBlobAuthenticationProperties("connection-string", null));
        var blob = client.getBlobContainerClient("researchhub-sources").getBlobClient("one-object");
        var values = new com.azure.storage.blob.sas.BlobServiceSasSignatureValues(
                java.time.OffsetDateTime.now().plusMinutes(5), new com.azure.storage.blob.sas.BlobSasPermission().setReadPermission(true));
        assertTrue(blob.generateSas(values).contains("sp=r"));
        var storage = new AzureBlobSourceStorage(client.getBlobContainerClient("researchhub-sources"), false, true);
        var access = storage.createTemporaryReadAccess(dev.researchhub.source.domain.StorageKey.generate(),
                java.time.Duration.ofMinutes(5)).orElseThrow();
        assertTrue(access.uri().getQuery().contains("sp=r"));
        assertTrue(access.uri().getQuery().contains("spr=https"));
        assertFalse(access.uri().getQuery().contains("https,http"));
    }
}
