package dev.researchhub.source.infrastructure;

import com.azure.storage.blob.BlobContainerClient;
import dev.researchhub.shared.infrastructure.persistence.PostgresIntegrationTest;
import dev.researchhub.source.application.SourceContent;
import dev.researchhub.source.application.SourceService;
import dev.researchhub.source.application.SourceStorage;
import dev.researchhub.source.application.SourceStorageContract;
import dev.researchhub.source.application.SourceSummary;
import dev.researchhub.source.application.UploadSourceCommand;
import dev.researchhub.source.domain.StorageKey;
import dev.researchhub.workspace.UserRowFixture;
import dev.researchhub.workspace.application.CreateWorkspaceCommand;
import dev.researchhub.workspace.application.WorkspaceService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.utility.DockerImageName;
import org.testcontainers.containers.wait.strategy.Wait;

import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** The storage contract plus a complete SourceService -> PostgreSQL + Azurite upload/read path. */
@PostgresIntegrationTest
@Testcontainers
class AzureBlobSourceStorageIntegrationTest extends SourceStorageContract {

    private static final String ACCOUNT = "devstoreaccount1";
    private static final String KEY =
            "Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==";

    @Container
    static final GenericContainer<?> AZURITE = new GenericContainer<>(
            DockerImageName.parse("mcr.microsoft.com/azure-storage/azurite:3.37.0"))
            .withExposedPorts(10000)
            .withCommand("azurite-blob", "--blobHost", "0.0.0.0", "--blobPort", "10000", "--location", "/data")
            .waitingFor(Wait.forListeningPort());

    @DynamicPropertySource
    static void blobProperties(DynamicPropertyRegistry properties) {
        properties.add("researchhub.sources.storage.adapter", () -> "azure-blob");
        properties.add("researchhub.sources.storage.azure-blob.endpoint", () ->
                "http://" + AZURITE.getHost() + ":" + AZURITE.getMappedPort(10000) + "/" + ACCOUNT);
        properties.add("researchhub.sources.storage.azure-blob.account-name", () -> ACCOUNT);
        properties.add("researchhub.sources.storage.azure-blob.account-key", () -> KEY);
        properties.add("researchhub.sources.storage.azure-blob.container-name", () -> "contract-sources");
    }

    @Autowired
    private SourceStorage storage;

    @Autowired
    private BlobContainerClient container;

    @Autowired
    private SourceService sources;

    @Autowired
    private WorkspaceService workspaces;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @Override
    protected SourceStorage storage() {
        return storage;
    }

    @Test
    void backendUploadStoresInAzuriteAndReadsTheSameObjectBack() throws Exception {
        byte[] csv = "sensor,value\ntemperature,21\n".getBytes(StandardCharsets.UTF_8);
        UUID owner = UserRowFixture.insertUser(jdbcTemplate, "azurite@example.com", "Azurite Test");
        UUID workspace = workspaces.create(new CreateWorkspaceCommand("Blob Lab", null, owner)).id();

        SourceSummary uploaded = sources.upload(workspace, owner,
                new UploadSourceCommand("measurements.csv", "text/csv", (long) csv.length,
                        new ByteArrayInputStream(csv)));

        String key = jdbcTemplate.queryForObject("SELECT storage_key FROM sources WHERE id = ?", String.class,
                uploaded.id());
        assertTrue(container.getBlobClient(key).exists(), "the source row points at a real Azurite blob");
        assertEquals("text/csv", container.getBlobClient(key).getProperties().getContentType());
        try (InputStream read = sources.openContent(workspace, owner, uploaded.id()).content()) {
            assertArrayEquals(csv, read.readAllBytes());
        }
    }

    @Test
    void aNewAdapterInstanceCanReadExistingBytes() throws Exception {
        StorageKey key = StorageKey.generate();
        byte[] bytes = "survives an application restart".getBytes(StandardCharsets.UTF_8);
        storage.store(key, new ByteArrayInputStream(bytes), "text/plain");

        SourceStorage restarted = new AzureBlobSourceStorage(container);

        try (InputStream read = restarted.open(key)) {
            assertArrayEquals(bytes, read.readAllBytes());
        }
    }

}
