package dev.researchhub.source.api;

import com.sun.net.httpserver.HttpServer;
import dev.researchhub.processing.application.*;
import dev.researchhub.processing.infrastructure.ProcessingProperties;
import dev.researchhub.source.application.*;
import dev.researchhub.source.infrastructure.*;
import dev.researchhub.shared.infrastructure.persistence.PostgresTestcontainersConfiguration;
import dev.researchhub.support.ApiBrowser;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.*;
import org.springframework.transaction.PlatformTransactionManager;
import tools.jackson.databind.ObjectMapper;

import java.net.*;
import java.net.http.*;
import java.nio.file.*;
import java.time.*;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

import static org.junit.jupiter.api.Assertions.*;

/** Real upload -> durable job -> authenticated Python HTTP worker -> PostgreSQL -> authorized product API. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@ActiveProfiles("local")
@TestPropertySource(properties = {"researchhub.sources.storage.adapter=in-memory", "researchhub.processing.dispatcher.enabled=false"})
@Import({PostgresTestcontainersConfiguration.class, SourceExtractionEndToEndTest.Configuration.class})
class SourceExtractionEndToEndTest {
    private static final String TOKEN = "end-to-end-test-worker-token-at-least-32-characters";
    private static final Map<String, byte[]> FILES = new ConcurrentHashMap<>();
    private static HttpServer blobServer;
    private static Process workerProcess;
    private static int workerPort;
    private static Path workerDirectory;

    @DynamicPropertySource
    static void workerProperties(DynamicPropertyRegistry registry) throws Exception {
        workerDirectory = Path.of("../ai-worker").toAbsolutePath().normalize();
        assertTrue(Files.isExecutable(workerDirectory.resolve(".venv/bin/python")), "Run uv sync --frozen in ai-worker before the E2E test");
        blobServer = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        blobServer.createContext("/", exchange -> {
            byte[] data = FILES.get(exchange.getRequestURI().getPath().substring(1));
            if (data == null) { exchange.sendResponseHeaders(404, -1); exchange.close(); return; }
            exchange.sendResponseHeaders(200, data.length);
            exchange.getResponseBody().write(data); exchange.close();
        });
        blobServer.start();
        try (var socket = new java.net.ServerSocket(0, 0, InetAddress.getLoopbackAddress())) { workerPort = socket.getLocalPort(); }
        var process = new ProcessBuilder(workerDirectory.resolve(".venv/bin/python").toString(), "-m", "researchhub_worker")
                .directory(workerDirectory.toFile()).redirectErrorStream(true)
                .redirectOutput(ProcessBuilder.Redirect.DISCARD);
        process.environment().put("AI_WORKER_HOST", "127.0.0.1");
        process.environment().put("AI_WORKER_PORT", Integer.toString(workerPort));
        process.environment().put("AI_WORKER_SERVICE_TOKEN", TOKEN);
        process.environment().put("AI_WORKER_XLSX_ROWS", "3");
        workerProcess = process.start();
        var http = HttpClient.newHttpClient();
        boolean ready = false;
        for (int index = 0; index < 100; index++) {
            try {
                ready = http.send(HttpRequest.newBuilder(URI.create(workerUrl() + "/health")).timeout(Duration.ofSeconds(1)).GET().build(),
                        HttpResponse.BodyHandlers.discarding()).statusCode() == 200;
                if (ready) break;
            } catch (java.io.IOException startup) { /* wait for the process to bind */ }
            Thread.sleep(100);
        }
        assertTrue(ready, "Python worker must start successfully");
        registry.add("researchhub.processing.worker.base-url", SourceExtractionEndToEndTest::workerUrl);
        registry.add("researchhub.processing.worker.service-token", () -> TOKEN);
    }
    private static String workerUrl() { return "http://127.0.0.1:" + workerPort; }

    @AfterAll static void stopWorker() throws Exception {
        if (workerProcess != null) { workerProcess.destroy(); if (!workerProcess.waitFor(5, java.util.concurrent.TimeUnit.SECONDS)) workerProcess.destroyForcibly(); }
        if (blobServer != null) blobServer.stop(0);
    }
    @TestConfiguration(proxyBeanMethods = false)
    static class Configuration {
        @Bean SourceStorage sourceStorage() { return new InMemorySourceStorage(); }
        @Bean @Primary SourceIngestInputProvider inputProvider(SourceRepository sources) {
            return (workspaceId, sourceId, ttl) -> {
                var source = sources.findByWorkspaceIdAndId(workspaceId, sourceId).orElseThrow().toDomain();
                return new SourceIngestInput(source.sourceType().name(), URI.create("http://127.0.0.1:" + blobServer.getAddress().getPort() + "/" + sourceId), Instant.now().plusSeconds(600));
            };
        }
    }
    @Value("${local.server.port}") int port;
    @Autowired ObjectMapper mapper;
    @Autowired JdbcTemplate jdbc;
    @Autowired SourceStorage storage;
    @Autowired ProcessingJobQueue queue;
    @Autowired ProcessingWorkerClient worker;
    @Autowired List<ProcessingJobStateListener> listeners;
    @Autowired ProcessingProperties properties;
    @Autowired PlatformTransactionManager transactionManager;
    @Autowired SourceExtractionService extractionService;
    @Autowired SourceExtractionRepository extractionRepository;
    @Autowired SourceRepository sources;
    private ApiBrowser owner;
    private String workspaceId;

    @BeforeEach void prepareWorkspace() throws Exception {
        cleanupRows();
        FILES.clear(); ((InMemorySourceStorage) storage).clear();

        owner = new ApiBrowser(port, mapper); owner.signUp("parser-owner@example.com", "Parser Owner");
        var response = owner.postJson("/api/workspaces", "{\"name\":\"Parsing\"}");
        assertEquals(201, response.statusCode(), response.body());
        workspaceId = owner.json(response).get("id").asString();
    }
    @AfterEach void cleanupRows() {
        jdbc.execute("DELETE FROM source_extractions");
        jdbc.execute("DELETE FROM processing_jobs"); jdbc.execute("DELETE FROM sources");
        jdbc.execute("DELETE FROM workspace_members"); jdbc.execute("DELETE FROM workspaces"); jdbc.execute("DELETE FROM users");
    }

    private String sourcePath(String id) { return "/api/workspaces/" + workspaceId + "/sources/" + id; }
    private String upload(String name, byte[] data) throws Exception {
        var response = owner.postFile("/api/workspaces/" + workspaceId + "/sources", name, "application/octet-stream", data);
        assertEquals(201, response.statusCode(), response.body());
        String id = owner.json(response).get("id").asString(); FILES.put(id, data); return id;
    }
    private void dispatch() {
        var policy = new ProcessingProperties();
        new ProcessingJobDispatcher(queue, worker, listeners, policy, Clock.systemUTC(), transactionManager).dispatchAvailable();
    }
    private byte[] fixture(String name) throws Exception { return Files.readAllBytes(Path.of("src/test/resources/parsing", name)); }

    @Test void extractsAllFormatsPersistsProvenanceAndProtectsWorkspaceAccess() throws Exception {
        String pdf = upload("lecture.pdf", fixture("lecture.pdf"));
        String docx = upload("sample.docx", fixture("sample.docx"));
        String xlsx = upload("workbook.xlsx", fixture("workbook.xlsx"));
        assertEquals(204, owner.get(sourcePath(pdf) + "/extraction").statusCode());
        dispatch();
        for (String id : List.of(pdf, docx, xlsx)) {
            assertEquals("READY", owner.json(owner.get(sourcePath(id))).get("status").asString());
            assertEquals("SUCCEEDED", jdbc.queryForObject("SELECT status FROM processing_jobs WHERE resource_id = ?", String.class, UUID.fromString(id)));
            var response = owner.get(sourcePath(id) + "/extraction");
            assertEquals(200, response.statusCode(), response.body());
            assertEquals("private, no-store", response.headers().firstValue("Cache-Control").orElseThrow());
            var output = owner.json(response);
            assertEquals(id, output.get("chunks").get(0).get("sourceId").asString());
            assertEquals(output.get("parserVersion").asString(), output.get("chunks").get(0).get("parserVersion").asString());
            assertEquals(owner.json(owner.get(sourcePath(id))).get("contentSha256"), output.get("extractionMetadata").get("contentSha256"));
        }
        var lecture = owner.json(owner.get(sourcePath(pdf) + "/extraction"));
        assertEquals(2, lecture.get("structure").get("pages").size());
        assertEquals("Lecture 2", lecture.get("chunks").get(1).get("text").asString());
        assertEquals(2, lecture.get("chunks").get(1).get("pageNumber").asInt());
        var document = owner.json(owner.get(sourcePath(docx) + "/extraction"));
        assertEquals("TABLE", document.get("chunks").get(3).get("location").get("kind").asString());
        assertEquals("Name\tValue\nmass\t3", document.get("chunks").get(3).get("text").asString());
        var workbook = owner.json(owner.get(sourcePath(xlsx) + "/extraction")).get("workbook");
        assertEquals(4, workbook.get("sheets").size());
        assertEquals("hidden", workbook.get("sheets").get(1).get("state").asString());
        assertEquals(3, workbook.get("sheets").get(0).get("sampledRows").asInt());
        assertTrue(workbook.get("sheets").get(0).get("truncated").asBoolean());
        var restored = new SourceExtractionRepository(jdbc, mapper).find(UUID.fromString(workspaceId), UUID.fromString(pdf)).orElseThrow();
        assertEquals("Lecture 2", restored.chunks().get(1).text());
        var viewer = new ApiBrowser(port, mapper); viewer.signUp("parser-viewer@example.com", "Viewer");
        assertEquals(201, owner.postJson("/api/workspaces/" + workspaceId + "/members",
                "{\"email\":\"parser-viewer@example.com\",\"role\":\"VIEWER\"}").statusCode());
        assertEquals(200, viewer.get(sourcePath(pdf) + "/extraction").statusCode());
        var outsider = new ApiBrowser(port, mapper); outsider.signUp("parser-outsider@example.com", "Outsider");
        var denied = outsider.get(sourcePath(pdf) + "/extraction");
        var missing = outsider.get(sourcePath(UUID.randomUUID().toString()) + "/extraction");
        assertEquals(404, denied.statusCode()); assertEquals(outsider.json(denied).get("detail"), outsider.json(missing).get("detail"));
        assertFalse(denied.body().contains("Lecture"));
        assertEquals(404, owner.get(sourcePath(UUID.randomUUID().toString()) + "/extraction").statusCode());
        assertEquals(3, jdbc.queryForObject("SELECT count(*) FROM source_extractions", Integer.class));
    }
    @Test void malformedAndScannedPdfsFailTheirDurableJobsSafely() throws Exception {
        String malformed = upload("broken.pdf", "%PDF-1.7\nprivate malformed data".getBytes());
        String scanned = upload("scan.pdf", fixture("scanned.pdf"));
        dispatch();
        for (String id : List.of(malformed, scanned)) {
            assertEquals("FAILED", owner.json(owner.get(sourcePath(id))).get("status").asString());
            assertEquals(204, owner.get(sourcePath(id) + "/extraction").statusCode());
        }
        assertEquals("DOCUMENT_PARSE_FAILED", jdbc.queryForObject("SELECT last_error_code FROM processing_jobs WHERE resource_id = ?", String.class, UUID.fromString(malformed)));
        assertEquals("OCR_REQUIRED", jdbc.queryForObject("SELECT last_error_code FROM processing_jobs WHERE resource_id = ?", String.class, UUID.fromString(scanned)));
        assertEquals(0, jdbc.queryForObject("SELECT count(*) FROM source_extractions", Integer.class));
        var rejected = owner.postFile("/api/workspaces/" + workspaceId + "/sources", "macro.xlsm", "application/octet-stream", fixture("workbook.xlsx"));
        assertEquals(415, rejected.statusCode());
    }
    @Test void hashMismatchAndObsoleteAttemptsCannotPublishAnExtraction() throws Exception {
        String id = upload("lecture.pdf", fixture("lecture.pdf"));
        var job = queue.claimNext(Instant.now(), 5).orElseThrow();
        var notification = ProcessingJobNotification.from(job);
        var result = mapper.readValue(Files.readString(Path.of("../contracts/processing/v2/source-ingest-result-success.json")), dev.researchhub.processing.infrastructure.WorkerJobResult.class).extraction();
        var chunk = result.chunks().get(0);
        var adjusted = new SourceExtraction(result.parserVersion(), result.extractionMetadata(), result.structure(),
                List.of(new SourceExtraction.ExtractedChunk(UUID.fromString(id), chunk.parserVersion(), chunk.location(), chunk.chunkId(), 0, chunk.text(), chunk.pageNumber(), chunk.sectionId(), chunk.characterStart(), chunk.characterEnd())), null, result.warnings());
        assertThrows(IllegalArgumentException.class, () -> extractionService.store(notification, adjusted));
        assertEquals(0, jdbc.queryForObject("SELECT count(*) FROM source_extractions", Integer.class));
        queue.updateState(job.id(), job.status(), job.attemptCount(), job.retry(new dev.researchhub.processing.domain.ProcessingJobError("RETRY", "Retry."), Instant.now()));
        assertThrows(IllegalStateException.class, () -> extractionService.store(notification, adjusted));
    }
}
