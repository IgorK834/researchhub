package dev.researchhub.processing.infrastructure;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import dev.researchhub.processing.application.SourceIngestInput;
import dev.researchhub.processing.application.SourceIngestInputProvider;
import dev.researchhub.processing.application.WorkerDispatchException;
import dev.researchhub.processing.domain.ProcessingJob;
import dev.researchhub.processing.domain.ProcessingJobType;
import dev.researchhub.processing.domain.ProcessingResourceType;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.ObjectMapper;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class HttpProcessingWorkerClientTest {

    private static final String SERVICE_TOKEN = "unit-test-service-token-at-least-32-characters";
    private HttpServer server;

    @AfterEach
    void stopServer() {
        if (server != null) {
            server.stop(0);
        }
    }

    @Test
    void authenticatedBackendDispatchesVersionedContractAndValidatesResult() throws IOException {
        AtomicReference<String> body = new AtomicReference<>();
        AtomicReference<HttpExchange> request = new AtomicReference<>();
        ProcessingJob job = runningJob();
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/internal/jobs/source-ingest", exchange -> {
            request.set(exchange);
            body.set(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
            send(exchange, 200, successResult(job));
        });
        server.start();

        client().execute(job);

        assertEquals("POST", request.get().getRequestMethod());
        assertTrue(request.get().getRequestHeaders().getFirst("Content-Type").startsWith("application/json"));
        assertEquals("Bearer " + SERVICE_TOKEN,
                request.get().getRequestHeaders().getFirst("Authorization"));
        assertEquals(job.requestId(),request.get().getRequestHeaders().getFirst("X-Request-ID"));
        assertFalse(request.get().getRequestHeaders().containsKey("Cookie"));
        assertTrue(body.get().contains("\"schemaVersion\":\"4.0\""), body.get());
        assertTrue(body.get().contains("\"jobId\":\"" + job.id() + "\""), body.get());
        assertTrue(body.get().contains("\"workspaceId\":\"" + job.workspaceId() + "\""), body.get());
        assertTrue(body.get().contains("\"sourceId\":\"" + job.resourceId() + "\""), body.get());
        assertTrue(body.get().contains("\"sourceType\":\"PDF\""), body.get());
        assertTrue(body.get().contains("\"kind\":\"SIGNED_URL\""), body.get());
        assertTrue(body.get().contains("\"requestedProcessingVersion\":\"source-ingest-4\""), body.get());
        assertTrue(body.get().contains("\"attempt\":1"), body.get());
        assertFalse(body.get().contains(SERVICE_TOKEN), body.get());
    }

    @Test
    void mapsWorkerRejectionToABoundedSafeFailure() throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/internal/jobs/source-ingest", exchange ->
                send(exchange, 503, "trace: password=private"));
        server.start();

        WorkerDispatchException failure = assertThrows(WorkerDispatchException.class,
                () -> client().execute(runningJob()));

        assertEquals("WORKER_HTTP_ERROR", failure.safeError().code());
        assertEquals("The processing worker rejected the job.", failure.safeError().message());
        assertFalse(failure.safeError().message().contains("private"));
    }

    @Test
    void rejectsMismatchedIdentityAndOversizedResults() throws IOException {
        ProcessingJob job = runningJob();
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        AtomicReference<String> response = new AtomicReference<>(successResult(job)
                .replace(job.workspaceId().toString(), UUID.randomUUID().toString()));
        server.createContext("/internal/jobs/source-ingest", exchange -> send(exchange, 200, response.get()));
        server.start();

        WorkerDispatchException mismatched = assertThrows(WorkerDispatchException.class,
                () -> client().execute(job));
        assertEquals("WORKER_CONTRACT_ERROR", mismatched.safeError().code());

        response.set("x".repeat(WorkerJobResult.MAX_RESPONSE_BYTES + 1));
        WorkerDispatchException oversized = assertThrows(WorkerDispatchException.class,
                () -> client().execute(job));
        assertEquals("WORKER_CONTRACT_ERROR", oversized.safeError().code());
    }

    @Test
    void propagatesOnlyTheWorkersSafeStructuredFailure() throws IOException {
        ProcessingJob job = runningJob();
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/internal/jobs/source-ingest", exchange -> send(exchange, 200, failedResult(job)));
        server.start();

        WorkerDispatchException failure = assertThrows(WorkerDispatchException.class,
                () -> client().execute(job));

        assertEquals("DOCUMENT_PARSE_FAILED", failure.safeError().code());
        assertEquals("The document could not be read.", failure.safeError().message());
    }

    private HttpProcessingWorkerClient client() {
        ProcessingProperties properties = new ProcessingProperties();
        properties.getWorker().setBaseUrl(URI.create("http://127.0.0.1:" + server.getAddress().getPort()));
        properties.getWorker().setRequestTimeout(Duration.ofSeconds(2));
        properties.getWorker().setServiceToken(SERVICE_TOKEN);
        SourceIngestInputProvider inputs = (_workspaceId, _sourceId, _jobId, _ttl) -> new SourceIngestInput("PDF",
                URI.create("http://127.0.0.1:10000/container/blob.pdf?sp=r&sig=temporary"),
                Instant.parse("2030-01-02T03:04:05Z"));
        return new HttpProcessingWorkerClient(properties, new ObjectMapper(), inputs, (_job, _extraction, _retrieval) -> {});
    }

    private static ProcessingJob runningJob() {
        Instant now = Instant.parse("2026-09-29T10:00:00Z");
        return ProcessingJob.pending(UUID.randomUUID(), ProcessingJobType.SOURCE_INGEST,
                ProcessingResourceType.SOURCE, UUID.randomUUID(), now).start(now.plusSeconds(1), 3);
    }

    private static String successResult(ProcessingJob job) {
        return """
                {"schemaVersion":"4.0","jobId":"%s","workspaceId":"%s","sourceId":"%s",
                "processingVersion":"source-ingest-4","status":"SUCCEEDED","duplicateDelivery":false,
                "extractionMetadata":{"title":null,"author":null,"language":null,"pageCount":0,
                "characterCount":0,"contentSha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},"structure":{"pages":[],"sections":[]},
                "chunks":[],"parserVersion":"test/rh-1","workbook":null,"warnings":[],"retrieval":%s,"failure":null}
                """.formatted(job.id(), job.workspaceId(), job.resourceId(), emptyRetrieval(job));
    }

    private static String emptyRetrieval(ProcessingJob job) {
        var config = new dev.researchhub.ai.application.ChunkingConfig("hierarchical-char-1",1600,150,200);
        String textHash = dev.researchhub.ai.application.RetrievalIdentity.hash("");
        String version = "retrieval-1:" + dev.researchhub.ai.application.RetrievalIdentity.digest(
                "source-ingest-4", "test/rh-1", "a".repeat(64), textHash, config.version(),1600,150,200);
        return new ObjectMapper().writeValueAsString(new dev.researchhub.ai.application.RetrievalChunkSet(
                "1.0",job.resourceId(),job.workspaceId(),null,"source-ingest-4","test/rh-1","a".repeat(64),textHash,version,config,java.util.List.of()));
    }

    private static String failedResult(ProcessingJob job) {
        return """
                {"schemaVersion":"4.0","jobId":"%s","workspaceId":"%s","sourceId":"%s",
                "processingVersion":"source-ingest-4","status":"FAILED","duplicateDelivery":false,
                "extractionMetadata":null,"structure":{"pages":[],"sections":[]},"chunks":[],"warnings":[],
                "failure":{"code":"DOCUMENT_PARSE_FAILED","message":"The document could not be read."}}
                """.formatted(job.id(), job.workspaceId(), job.resourceId());
    }

    private static void send(HttpExchange exchange, int status, String body) throws IOException {
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().set("Content-Type", "application/json");
        exchange.sendResponseHeaders(status, bytes.length);
        exchange.getResponseBody().write(bytes);
        exchange.close();
    }
}
