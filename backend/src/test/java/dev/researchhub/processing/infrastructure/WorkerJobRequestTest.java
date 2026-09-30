package dev.researchhub.processing.infrastructure;

import dev.researchhub.processing.application.SourceIngestInput;
import dev.researchhub.processing.domain.ProcessingJob;
import dev.researchhub.processing.domain.ProcessingJobStatus;
import dev.researchhub.processing.domain.ProcessingJobType;
import dev.researchhub.processing.domain.ProcessingResourceType;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.net.URI;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;

class WorkerJobRequestTest {

    private static final UUID JOB_ID = UUID.fromString("018f1f7a-6c20-7c2f-9d3f-4cda0ca3b8bd");
    private static final UUID WORKSPACE_ID = UUID.fromString("018f1f79-cbc4-7ac8-a454-d7bf0ead9a46");
    private static final UUID SOURCE_ID = UUID.fromString("018f1f7a-13a5-7d54-a210-57f87bbcf682");

    @Test
    void javaSerializationAgreesWithTheSharedPythonFixture() throws Exception {
        Instant created = Instant.parse("2026-09-29T10:00:00Z");
        ProcessingJob running = new ProcessingJob(JOB_ID, WORKSPACE_ID, ProcessingJobType.SOURCE_INGEST,
                ProcessingResourceType.SOURCE, SOURCE_ID, ProcessingJobStatus.RUNNING, 1, created,
                created.plusSeconds(1), null, null, null);
        JsonNode fixture = mapper().readTree(Files.readString(fixture("source-ingest-request.json")));
        SourceIngestInput input = new SourceIngestInput("PDF",
                URI.create(fixture.get("fileAccess").get("url").asText()),
                Instant.parse(fixture.get("fileAccess").get("expiresAt").asText()));

        WorkerJobRequest request = WorkerJobRequest.from(running, input);
        JsonNode serialized = mapper().valueToTree(request);

        assertEquals(fixture, serialized);
        assertFalse(serialized.toString().toLowerCase().contains("token"));
        assertFalse(serialized.toString().contains("storageKey"));
    }

    @Test
    void javaDeserializationAcceptsBothSharedResultFixturesAndValidatesIdentity() throws Exception {
        ObjectMapper mapper = mapper();
        ProcessingJob job = fixtureJob();

        WorkerJobResult success = mapper.readValue(
                Files.readAllBytes(fixture("source-ingest-result-success.json")), WorkerJobResult.class);
        WorkerJobResult failed = mapper.readValue(
                Files.readAllBytes(fixture("source-ingest-result-failure.json")), WorkerJobResult.class);

        success.validateFor(job);
        failed.validateFor(job);
        assertEquals("DOCUMENT_PARSE_FAILED", failed.safeFailure().code());
    }

    private static ProcessingJob fixtureJob() {
        Instant created = Instant.parse("2026-09-29T10:00:00Z");
        return new ProcessingJob(JOB_ID, WORKSPACE_ID, ProcessingJobType.SOURCE_INGEST,
                ProcessingResourceType.SOURCE, SOURCE_ID, ProcessingJobStatus.RUNNING, 1, created,
                created.plusSeconds(1), null, null, null);
    }

    private static ObjectMapper mapper() {
        return new ObjectMapper();
    }

    private static Path fixture(String name) {
        Path fromModule = Path.of("..", "contracts", "processing", "v2", name);
        return Files.exists(fromModule) ? fromModule : Path.of("contracts", "processing", "v2", name);
    }
}
