package dev.researchhub.processing.infrastructure;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import dev.researchhub.processing.application.WorkerDispatchException;
import dev.researchhub.processing.domain.ProcessingJob;
import dev.researchhub.processing.domain.ProcessingJobType;
import dev.researchhub.processing.domain.ProcessingResourceType;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

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

    private HttpServer server;

    @AfterEach
    void stopServer() {
        if (server != null) {
            server.stop(0);
        }
    }

    @Test
    void sendsOnlyTheExplicitInternalContractWithoutUserCredentials() throws IOException {
        AtomicReference<String> body = new AtomicReference<>();
        AtomicReference<HttpExchange> request = new AtomicReference<>();
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/internal/jobs/source-ingest", exchange -> {
            request.set(exchange);
            body.set(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
            exchange.sendResponseHeaders(204, -1);
            exchange.close();
        });
        server.start();
        ProcessingJob job = runningJob();

        client().execute(job);

        assertEquals("POST", request.get().getRequestMethod());
        assertTrue(request.get().getRequestHeaders().getFirst("Content-Type").startsWith("application/json"));
        assertFalse(request.get().getRequestHeaders().containsKey("Authorization"));
        assertFalse(request.get().getRequestHeaders().containsKey("Cookie"));
        assertTrue(body.get().contains("\"jobId\":\"" + job.id() + "\""), body.get());
        assertTrue(body.get().contains("\"workspaceId\":\"" + job.workspaceId() + "\""), body.get());
        assertTrue(body.get().contains("\"jobType\":\"SOURCE_INGEST\""), body.get());
        assertTrue(body.get().contains("\"resourceType\":\"SOURCE\""), body.get());
        assertTrue(body.get().contains("\"resourceId\":\"" + job.resourceId() + "\""), body.get());
        assertTrue(body.get().contains("\"attempt\":1"), body.get());
        assertFalse(body.get().toLowerCase().contains("token"), body.get());
    }

    @Test
    void mapsWorkerRejectionToABoundedSafeFailure() throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/internal/jobs/source-ingest", exchange -> {
            byte[] privateDetails = "trace: password=private".getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(503, privateDetails.length);
            exchange.getResponseBody().write(privateDetails);
            exchange.close();
        });
        server.start();

        WorkerDispatchException failure = assertThrows(WorkerDispatchException.class,
                () -> client().execute(runningJob()));

        assertEquals("WORKER_HTTP_ERROR", failure.safeError().code());
        assertEquals("The processing worker rejected the job.", failure.safeError().message());
        assertFalse(failure.safeError().message().contains("private"));
    }

    private HttpProcessingWorkerClient client() {
        ProcessingProperties properties = new ProcessingProperties();
        properties.getWorker().setBaseUrl(URI.create("http://127.0.0.1:" + server.getAddress().getPort()));
        properties.getWorker().setRequestTimeout(Duration.ofSeconds(2));
        return new HttpProcessingWorkerClient(properties);
    }

    private static ProcessingJob runningJob() {
        Instant now = Instant.parse("2026-09-29T10:00:00Z");
        return ProcessingJob.pending(UUID.randomUUID(), ProcessingJobType.SOURCE_INGEST,
                ProcessingResourceType.SOURCE, UUID.randomUUID(), now).start(now.plusSeconds(1), 3);
    }
}
