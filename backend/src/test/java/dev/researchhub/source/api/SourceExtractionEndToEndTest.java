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
    @Autowired dev.researchhub.ai.application.RetrievalIndex retrievalIndex;
    @org.springframework.test.context.bean.override.mockito.MockitoSpyBean
    dev.researchhub.ai.application.EmbeddingProvider embeddings;
    private ApiBrowser owner;
    private String workspaceId;

    @BeforeEach void prepareWorkspace() throws Exception {
        cleanupRows();
        FILES.clear(); ((InMemorySourceStorage) storage).clear();

        owner = new ApiBrowser(port, mapper);
        var csrfProbe = owner.get("/api/auth/csrf");
        assertEquals(204, csrfProbe.statusCode(), "CSRF probe status; port=" + port);
        assertTrue(csrfProbe.headers().firstValue("Set-Cookie").isPresent(), "CSRF cookie missing; header names=" + csrfProbe.headers().map().keySet());
        owner.signUp("parser-owner@example.com", "Parser Owner");
        var response = owner.postJson("/api/workspaces", "{\"name\":\"Parsing\"}");
        assertEquals(201, response.statusCode(), response.body());
        workspaceId = owner.json(response).get("id").asString();
    }
    @AfterEach void cleanupRows() {
        jdbc.execute("DELETE FROM source_retrieval_chunks");
        jdbc.execute("DELETE FROM source_retrieval_sets");
        jdbc.execute("DELETE FROM retrieval_embedding_models");
        jdbc.execute("DELETE FROM source_extraction_runs");
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
        var retrieval = mapper.readValue(owner.get(sourcePath(pdf) + "/retrieval").body(), dev.researchhub.ai.application.RetrievalChunkSet.class);
        assertEquals(List.of(1,2), retrieval.chunks().stream().map(dev.researchhub.ai.application.RetrievalChunk::pageStart).toList());
        assertEquals(retrieval.chunks().stream().map(dev.researchhub.ai.application.RetrievalChunk::pageStart).toList(), retrieval.chunks().stream().map(dev.researchhub.ai.application.RetrievalChunk::pageEnd).toList());
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
        var result = mapper.readValue(Files.readString(Path.of("../contracts/processing/v4/source-ingest-result-success.json")), dev.researchhub.processing.infrastructure.WorkerJobResult.class).extraction();
        var chunk = result.chunks().get(0);
        var adjusted = new SourceExtraction(result.processingVersion(), result.parserVersion(), result.extractionMetadata(), result.structure(),
                List.of(new SourceExtraction.ExtractedChunk(UUID.fromString(id), chunk.parserVersion(), chunk.location(), chunk.chunkId(), 0, chunk.text(), chunk.pageNumber(), chunk.sectionId(), chunk.characterStart(), chunk.characterEnd())), null, result.warnings());
        assertThrows(IllegalArgumentException.class, () -> extractionService.store(notification, adjusted, null));
        assertEquals(0, jdbc.queryForObject("SELECT count(*) FROM source_extractions", Integer.class));
        queue.updateState(job.id(), job.status(), job.attemptCount(), job.retry(new dev.researchhub.processing.domain.ProcessingJobError("RETRY", "Retry."), Instant.now()));
        assertThrows(IllegalStateException.class, () -> extractionService.store(notification, adjusted, null));
    }
    @Test void previewAndCitationLocationsAreAuthorizedAndPageAware() throws Exception {
        String id = upload("lecture.pdf", fixture("lecture.pdf"));
        dispatch();
        var preview = owner.get(sourcePath(id) + "/preview");
        assertEquals(200, preview.statusCode());
        assertEquals("application/pdf", preview.headers().firstValue("Content-Type").orElseThrow());
        assertTrue(preview.headers().firstValue("Content-Disposition").orElseThrow().startsWith("inline;"));
        assertEquals("nosniff", preview.headers().firstValue("X-Content-Type-Options").orElseThrow());
        assertEquals("sandbox", preview.headers().firstValue("Content-Security-Policy").orElseThrow());
        assertEquals("private, no-store", preview.headers().firstValue("Cache-Control").orElseThrow());
        var output = owner.json(owner.get(sourcePath(id) + "/extraction"));
        String unit = output.get("chunks").get(1).get("chunkId").asString();
        var locationResponse = owner.get(sourcePath(id) + "/locations?pageNumber=2");
        assertEquals(200, locationResponse.statusCode(), locationResponse.body());
        var location = owner.json(locationResponse);
        assertEquals(unit, location.get("unitId").asString());
        assertEquals(2, location.get("pageNumber").asInt());
        assertEquals(sourcePath(id) + "/preview#page=2", location.get("previewUrl").asString());
        assertTrue(location.get("sourceUrl").asString().contains("&page=2"));
        assertEquals("source-ingest-4", location.get("processingVersion").asString());
        assertEquals(location, owner.json(owner.get(sourcePath(id) + "/locations/" + unit)));
        assertEquals(404, owner.get(sourcePath(id) + "/locations?pageNumber=999").statusCode());
        assertEquals(404, owner.get(sourcePath(id) + "/locations/missing").statusCode());
        String csv = upload("data.csv", "name,value\nAda,3\nBob,5\n".getBytes(java.nio.charset.StandardCharsets.UTF_8));
        dispatch();
        assertEquals(415, owner.get(sourcePath(csv) + "/preview").statusCode());
        var sheet = owner.json(owner.get(sourcePath(csv) + "/extraction")).get("workbook").get("sheets").get(0);
        assertEquals(3, sheet.get("previewRows").size());
        assertEquals("Bob", sheet.get("previewRows").get(2).get("cells").get(0).asString());
        var csvLocation = owner.json(owner.get(sourcePath(csv) + "/locations/unit-0"));
        assertTrue(csvLocation.get("sourceUrl").asString().contains("&sheet=CSV"));
        assertTrue(csvLocation.get("previewUrl").isNull());
        var outsider = new ApiBrowser(port, mapper); outsider.signUp("outside@example.com", "Outsider");
        for (String suffix : List.of("/preview", "/extraction/runs", "/locations/" + unit)) {
            assertEquals(404, outsider.get(sourcePath(id) + suffix).statusCode());
        }
    }

    @Test void reprocessingUsesFreshIdentityAndKeepsOnePayloadWithVersionHistory() throws Exception {
        String id = upload("lecture.pdf", fixture("lecture.pdf"));
        assertEquals(409, owner.postJson(sourcePath(id) + "/reprocess", "{}").statusCode());
        dispatch();
        UUID sourceId = UUID.fromString(id);
        UUID firstJob = jdbc.queryForObject("SELECT job_id FROM source_extractions WHERE source_id = ?", UUID.class, sourceId);
        String firstHash = jdbc.queryForObject("SELECT payload_sha256 FROM source_extractions WHERE source_id = ?", String.class, sourceId);
        var original = owner.json(owner.get(sourcePath(id)));
        var viewer = new ApiBrowser(port, mapper); viewer.signUp("rerun-viewer@example.com", "Viewer");
        owner.postJson("/api/workspaces/" + workspaceId + "/members", "{\"email\":\"rerun-viewer@example.com\",\"role\":\"VIEWER\"}");
        assertEquals(403, viewer.postJson(sourcePath(id) + "/reprocess", "{}").statusCode());
        assertEquals(200, viewer.get(sourcePath(id) + "/preview").statusCode());
        assertEquals(200, viewer.get(sourcePath(id) + "/extraction/runs").statusCode());
        var rerun = owner.postJson(sourcePath(id) + "/reprocess", "{}");
        assertEquals(202, rerun.statusCode(), rerun.body());
        assertEquals("PROCESSING", owner.json(rerun).get("status").asString());
        assertEquals(204, owner.get(sourcePath(id) + "/extraction").statusCode());
        assertEquals(409, owner.postJson(sourcePath(id) + "/reprocess", "{}").statusCode());
        var oldNotification = ProcessingJobNotification.from(queue.find(firstJob).orElseThrow());
        listeners.stream().filter(listener -> listener.supports(oldNotification)).forEach(listener -> {
            listener.succeeded(oldNotification);
            listener.failed(oldNotification, new ProcessingFailure("LATE", "Late result."));
        });
        assertEquals("PROCESSING", owner.json(owner.get(sourcePath(id))).get("status").asString());
        dispatch();
        assertEquals("READY", owner.json(owner.get(sourcePath(id))).get("status").asString());
        assertEquals(original.get("contentSha256"), owner.json(owner.get(sourcePath(id))).get("contentSha256"));
        UUID secondJob = jdbc.queryForObject("SELECT job_id FROM source_extractions WHERE source_id = ?", UUID.class, sourceId);
        assertNotEquals(firstJob, secondJob);
        assertEquals(firstHash, jdbc.queryForObject("SELECT payload_sha256 FROM source_extractions WHERE source_id = ?", String.class, sourceId));
        assertEquals(1, jdbc.queryForObject("SELECT count(*) FROM source_extractions WHERE source_id = ?", Integer.class, sourceId));
        var history = owner.json(owner.get(sourcePath(id) + "/extraction/runs"));
        assertEquals(2, history.size());
        assertEquals(secondJob.toString(), history.get(0).get("jobId").asString());
        assertEquals("source-ingest-4", history.get(0).get("processingVersion").asString());
        assertEquals("4.0", history.get(0).get("schemaVersion").asString());
        assertEquals("SUCCEEDED", history.get(0).get("jobStatus").asString());
        assertThrows(org.springframework.dao.DataAccessException.class,
                () -> jdbc.update("UPDATE processing_jobs SET generation=42 WHERE id=?", secondJob));
    }

    @Test void persistenceFailureRollsBackOutputAndNeverPublishesReady() throws Exception {
        String id = upload("lecture.pdf", fixture("lecture.pdf"));
        jdbc.execute("CREATE FUNCTION reject_extraction_run() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'private database failure'; END; $$");
        jdbc.execute("CREATE TRIGGER reject_extraction_run BEFORE INSERT ON source_extraction_runs FOR EACH ROW EXECUTE FUNCTION reject_extraction_run()");
        try {
            var policy = new ProcessingProperties(); policy.getDispatcher().setMaxAttempts(1);
            new ProcessingJobDispatcher(queue, worker, listeners, policy, Clock.systemUTC(), transactionManager).dispatchAvailable();
            var source = owner.json(owner.get(sourcePath(id)));
            assertEquals("FAILED", source.get("status").asString());
            assertEquals("The processing worker could not complete the job.", source.get("failureSummary").asString());
            assertFalse(source.toString().contains("private database"));
            assertEquals("FAILED", jdbc.queryForObject("SELECT status FROM processing_jobs WHERE resource_id=?", String.class, UUID.fromString(id)));
            assertEquals(0, jdbc.queryForObject("SELECT count(*) FROM source_extractions", Integer.class));
            assertEquals(0, jdbc.queryForObject("SELECT count(*) FROM source_extraction_runs", Integer.class));
            assertEquals(204, owner.get(sourcePath(id) + "/extraction").statusCode());
        } finally {
            jdbc.execute("DROP TRIGGER reject_extraction_run ON source_extraction_runs");
            jdbc.execute("DROP FUNCTION reject_extraction_run()");
        }
        assertEquals(202, owner.postJson(sourcePath(id) + "/reprocess", "{}").statusCode());
        dispatch();
        assertEquals("READY", owner.json(owner.get(sourcePath(id))).get("status").asString());
    }

    @Test void repeatedResultDeliveryIsIdempotentAndRequiresExplicitCompletion() throws Exception {
        String id = upload("lecture.pdf", fixture("lecture.pdf"));
        var job = queue.claimNext(Instant.now(), 5).orElseThrow();
        var notification = ProcessingJobNotification.from(job);
        listeners.stream().filter(listener -> listener.supports(notification)).forEach(listener -> listener.running(notification));
        worker.execute(job);
        var before = extractionRepository.runs(UUID.fromString(workspaceId), UUID.fromString(id));
        assertEquals(1, before.size());
        assertEquals("PROCESSING", owner.json(owner.get(sourcePath(id))).get("status").asString());
        assertEquals(204, owner.get(sourcePath(id) + "/extraction").statusCode());
        worker.execute(job);
        assertEquals(before, extractionRepository.runs(UUID.fromString(workspaceId), UUID.fromString(id)));
        assertEquals(1, jdbc.queryForObject("SELECT count(*) FROM source_extractions", Integer.class));
        var completed = job.succeed(Instant.now());
        new org.springframework.transaction.support.TransactionTemplate(transactionManager).executeWithoutResult(_status -> {
            assertTrue(queue.updateState(job.id(), job.status(), job.attemptCount(), completed));
            var success = ProcessingJobNotification.from(completed);
            listeners.stream().filter(listener -> listener.supports(success)).forEach(listener -> listener.succeeded(success));
        });
        assertEquals("READY", owner.json(owner.get(sourcePath(id))).get("status").asString());
    }

    private static void restartWorker(int max, int overlap, int min) throws Exception {
        workerProcess.destroy();
        if (!workerProcess.waitFor(5, java.util.concurrent.TimeUnit.SECONDS)) workerProcess.destroyForcibly().waitFor();
        var process = new ProcessBuilder(workerDirectory.resolve(".venv/bin/python").toString(), "-m", "researchhub_worker")
                .directory(workerDirectory.toFile()).redirectErrorStream(true).redirectOutput(ProcessBuilder.Redirect.DISCARD);
        process.environment().put("AI_WORKER_HOST", "127.0.0.1");
        process.environment().put("AI_WORKER_PORT", Integer.toString(workerPort));
        process.environment().put("AI_WORKER_SERVICE_TOKEN", TOKEN);
        process.environment().put("AI_WORKER_XLSX_ROWS", "3");
        process.environment().put("AI_WORKER_CHUNK_MAX_CHARACTERS", Integer.toString(max));
        process.environment().put("AI_WORKER_CHUNK_OVERLAP_CHARACTERS", Integer.toString(overlap));
        process.environment().put("AI_WORKER_CHUNK_MIN_CHARACTERS", Integer.toString(min));
        workerProcess = process.start();
        var http = HttpClient.newHttpClient();
        for (int attempt = 0; attempt < 100; attempt++) {
            try {
                if (http.send(HttpRequest.newBuilder(URI.create(workerUrl() + "/health")).timeout(Duration.ofSeconds(1)).GET().build(), HttpResponse.BodyHandlers.discarding()).statusCode() == 200) return;
            } catch (java.io.IOException startup) { /* wait for binding */ }
            Thread.sleep(100);
        }
        fail("Restarted worker must be healthy");
    }

    @Test void retrievalIsAuthorizedVersionedAndReprocessingReplacesTheWholeSet() throws Exception {
        String id = upload("notes.txt", ("λ😀 quoted text and evidence.\n\n".repeat(180)).getBytes(java.nio.charset.StandardCharsets.UTF_8));
        assertEquals(204, owner.get(sourcePath(id) + "/retrieval").statusCode());
        dispatch();
        var response = owner.get(sourcePath(id) + "/retrieval");
        assertEquals(200, response.statusCode(), response.body());
        assertEquals("private, no-store", response.headers().firstValue("Cache-Control").orElseThrow());
        var first = mapper.readValue(response.body(), dev.researchhub.ai.application.RetrievalChunkSet.class);
        assertTrue(first.chunks().size() > 1);
        assertTrue(first.chunks().stream().allMatch(chunk -> chunk.workspaceId().toString().equals(workspaceId)
                && chunk.sourceId().toString().equals(id) && chunk.sourceVersionId() == null));
        assertEquals(first.chunks().getFirst(), mapper.readValue(owner.get(sourcePath(id) + "/retrieval/chunks/" + first.chunks().getFirst().chunkId()).body(), dev.researchhub.ai.application.RetrievalChunk.class));
        var viewer = new ApiBrowser(port, mapper); viewer.signUp("retrieval-viewer@example.com", "Viewer");
        owner.postJson("/api/workspaces/" + workspaceId + "/members", "{\"email\":\"retrieval-viewer@example.com\",\"role\":\"VIEWER\"}");
        assertEquals(200, viewer.get(sourcePath(id) + "/retrieval").statusCode());
        var outsider = new ApiBrowser(port, mapper); outsider.signUp("retrieval-outsider@example.com", "Outsider");
        for (String suffix : List.of("/retrieval", "/retrieval/chunks/" + first.chunks().getFirst().chunkId())) {
            assertEquals(404, outsider.get(sourcePath(id) + suffix).statusCode());
            assertEquals(404, owner.get(sourcePath(UUID.randomUUID().toString()) + suffix).statusCode());
        }
        assertEquals(404, owner.get(sourcePath(id) + "/retrieval/chunks/missing").statusCode());
        try {
            restartWorker(96,12,20);
            assertEquals(202, owner.postJson(sourcePath(id) + "/reprocess", "{}").statusCode());
            assertEquals(204, owner.get(sourcePath(id) + "/retrieval").statusCode());
            assertEquals(404, owner.get(sourcePath(id) + "/retrieval/chunks/" + first.chunks().getFirst().chunkId()).statusCode());
            dispatch();
            var nextResponse = owner.get(sourcePath(id) + "/retrieval");
            assertEquals(200, nextResponse.statusCode(), nextResponse.body());
            var next = mapper.readValue(nextResponse.body(), dev.researchhub.ai.application.RetrievalChunkSet.class);
            assertNotEquals(first.processingVersion(), next.processingVersion());
            assertEquals(96, next.config().maxCharacters());
            assertTrue(next.chunks().size() > first.chunks().size());
            assertTrue(Collections.disjoint(first.chunks().stream().map(dev.researchhub.ai.application.RetrievalChunk::chunkId).toList(),
                    next.chunks().stream().map(dev.researchhub.ai.application.RetrievalChunk::chunkId).toList()));
            assertEquals(409, owner.get(sourcePath(id) + "/retrieval?processingVersion=" + first.processingVersion()).statusCode());
            assertEquals(404, owner.get(sourcePath(id) + "/retrieval/chunks/" + first.chunks().getFirst().chunkId()).statusCode());
            assertEquals(next.chunks().size(), jdbc.queryForObject("SELECT count(*) FROM source_retrieval_chunks WHERE source_id=?", Integer.class, UUID.fromString(id)));
            assertEquals(0, jdbc.queryForObject("SELECT count(*) FROM information_schema.columns WHERE table_name='source_retrieval_chunks' AND column_name='content'", Integer.class));
            var history = owner.json(owner.get(sourcePath(id) + "/extraction/runs"));
            assertEquals(next.processingVersion(), history.get(0).get("retrievalProcessingVersion").asString());
            assertEquals(96, history.get(0).get("chunkingConfig").get("maxCharacters").asInt());
            assertEquals(202, owner.postJson(sourcePath(id) + "/reprocess", "{}").statusCode());
            dispatch();
            assertEquals(next, mapper.readValue(owner.get(sourcePath(id) + "/retrieval").body(), dev.researchhub.ai.application.RetrievalChunkSet.class));
        } finally { restartWorker(1600,150,200); }
    }

    @Test void retrievalWriteFailureRollsBackExtractionAndPreventsReady() throws Exception {
        String id = upload("lecture.pdf", fixture("lecture.pdf"));
        jdbc.execute("CREATE FUNCTION drop_retrieval_chunk() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NULL; END; $$");
        jdbc.execute("CREATE TRIGGER drop_retrieval_chunk BEFORE INSERT ON source_retrieval_chunks FOR EACH ROW EXECUTE FUNCTION drop_retrieval_chunk()");
        try {
            var policy = new ProcessingProperties(); policy.getDispatcher().setMaxAttempts(1);
            new ProcessingJobDispatcher(queue, worker, listeners, policy, Clock.systemUTC(), transactionManager).dispatchAvailable();
            assertEquals("FAILED", owner.json(owner.get(sourcePath(id))).get("status").asString());
            for (String table : List.of("source_extractions", "source_extraction_runs", "source_retrieval_sets", "source_retrieval_chunks")) {
                assertEquals(0, jdbc.queryForObject("SELECT count(*) FROM " + table, Integer.class));
            }
            assertEquals(204, owner.get(sourcePath(id) + "/retrieval").statusCode());
        } finally {
            jdbc.execute("DROP TRIGGER drop_retrieval_chunk ON source_retrieval_chunks");
            jdbc.execute("DROP FUNCTION drop_retrieval_chunk()");
        }
    }


    private String searchPath(String workspace) { return "/api/workspaces/" + workspace + "/retrieval/search?query=Lecture%202"; }

    @Test void pdfUploadBecomesSearchableAndTwoWorkspacesAreIsolatedInsideTheIndex() throws Exception {
        String pdfA = upload("lecture.pdf", fixture("lecture.pdf"));
        String otherA = upload("other.txt", "Mass and force in physics".getBytes(java.nio.charset.StandardCharsets.UTF_8));
        String workspaceB = owner.json(owner.postJson("/api/workspaces", "{\"name\":\"Workspace B\"}")).get("id").asString();
        var uploadedB = owner.postFile("/api/workspaces/" + workspaceB + "/sources", "lecture.pdf", "application/pdf", fixture("lecture.pdf"));
        assertEquals(201, uploadedB.statusCode());
        String pdfB = owner.json(uploadedB).get("id").asString(); FILES.put(pdfB,fixture("lecture.pdf"));
        assertEquals(0, owner.json(owner.get(searchPath(workspaceId))).size());
        var queued = owner.json(owner.get(sourcePath(pdfA) + "/processing"));
        assertEquals(0, queued.get("progress").asInt());
        org.mockito.Mockito.doAnswer(invocation -> {
            assertEquals("EMBED",jdbc.queryForObject("SELECT stage FROM processing_jobs WHERE status='RUNNING'",String.class));
            return invocation.callRealMethod();
        }).when(embeddings).embedDocuments(org.mockito.ArgumentMatchers.anyList());
        dispatch();
        var progress = owner.json(owner.get(sourcePath(pdfA) + "/processing"));
        assertEquals("FINALIZE",progress.get("stage").asString()); assertEquals(100,progress.get("progress").asInt());
        var hitsA = owner.json(owner.get(searchPath(workspaceId)));
        assertEquals(3,hitsA.size());
        assertEquals(pdfA,hitsA.get(0).get("chunk").get("sourceId").asString());
        assertEquals(2,hitsA.get(0).get("chunk").get("pageStart").asInt());
        assertEquals(32,hitsA.get(0).get("model").get("dimension").asInt());
        assertTrue(hitsA.get(0).get("lexicalScore").asDouble() > 0);
        for (var hit : hitsA) assertEquals(workspaceId,hit.get("chunk").get("workspaceId").asString());
        var hitsB = owner.json(owner.get(searchPath(workspaceB)));
        assertEquals(2,hitsB.size());
        for (var hit : hitsB) assertEquals(pdfB,hit.get("chunk").get("sourceId").asString());
        // Call the adapter directly as well: security cannot depend on the controller's post-filtering.
        var direct = retrievalIndex.search("Lecture 2",UUID.fromString(workspaceB),null,50,embeddings.embedQuery("Lecture 2"));
        assertEquals(2,direct.size()); assertTrue(direct.stream().allMatch(h -> h.chunk().workspaceId().toString().equals(workspaceB)));
        assertEquals(0,retrievalIndex.search("Lecture",UUID.fromString(workspaceB),List.of(UUID.fromString(pdfA)),10,embeddings.embedQuery("Lecture")).size());
        assertEquals(0,retrievalIndex.search("Lecture",UUID.fromString(workspaceB),List.of(),10,embeddings.embedQuery("Lecture")).size());
        var selected = owner.json(owner.get(searchPath(workspaceId) + "&sourceIds=" + otherA));
        assertEquals(1,selected.size()); assertEquals(otherA,selected.get(0).get("chunk").get("sourceId").asString());
        assertEquals(1,owner.json(owner.get(searchPath(workspaceId) + "&topK=1")).size());
        assertEquals(404,owner.get(searchPath(workspaceId) + "&sourceIds=" + pdfB).statusCode());
        assertEquals(400,owner.get(searchPath(workspaceId) + "&topK=51").statusCode());
        assertEquals(400,owner.get("/api/workspaces/" + workspaceId + "/retrieval/search?query=%20").statusCode());
        var outsider = new ApiBrowser(port,mapper); outsider.signUp("search-outsider@example.com","Outsider");
        assertEquals(404,outsider.get(searchPath(workspaceId)).statusCode());
        assertEquals(404,outsider.get(sourcePath(pdfA) + "/processing").statusCode());
        assertEquals(404,owner.get(sourcePath(pdfB) + "/processing").statusCode());
        // Deletion is workspace-scoped, and rebuild creates exactly one projection per chunk.
        retrievalIndex.delete(UUID.fromString(workspaceB),UUID.fromString(pdfA));
        assertEquals(3,owner.json(owner.get(searchPath(workspaceId))).size());
        retrievalIndex.delete(UUID.fromString(workspaceB),UUID.fromString(pdfB));
        assertEquals(0,owner.json(owner.get(searchPath(workspaceB))).size());
        var oldIds = hitsA.toString();
        assertEquals(202,owner.postJson(sourcePath(pdfA) + "/reprocess","{}").statusCode());
        assertEquals(1,owner.json(owner.get(searchPath(workspaceId))).size()); // old PDF projection is hidden while rebuilding
        dispatch();
        assertEquals(oldIds,owner.json(owner.get(searchPath(workspaceId))).toString());
        assertEquals(2,jdbc.queryForObject("SELECT count(*) FROM source_chunk_embeddings WHERE source_id=?",Integer.class,UUID.fromString(pdfA)));
    }

    @Test void embeddingFailureLeavesNoPublishedResultAndTransientRetryIsIdempotent() throws Exception {
        String id = upload("lecture.pdf",fixture("lecture.pdf"));
        org.mockito.Mockito.doThrow(new dev.researchhub.ai.application.EmbeddingFailure(null,true))
            .when(embeddings).embedDocuments(org.mockito.ArgumentMatchers.anyList());
        var policy = new ProcessingProperties(); policy.getDispatcher().setMaxAttempts(2); policy.getDispatcher().setBatchSize(1);
        policy.getDispatcher().setInitialBackoff(Duration.ofNanos(1));
        var dispatcher = new ProcessingJobDispatcher(queue,worker,listeners,policy,Clock.systemUTC(),transactionManager);
        dispatcher.dispatchAvailable();
        assertEquals("PROCESSING",owner.json(owner.get(sourcePath(id))).get("status").asString());
        assertEquals("PENDING",owner.json(owner.get(sourcePath(id) + "/processing")).get("status").asString());
        assertEquals("EMBED",owner.json(owner.get(sourcePath(id) + "/processing")).get("stage").asString());
        assertEquals(0,jdbc.queryForObject("SELECT count(*) FROM source_extractions",Integer.class));
        assertEquals(0,owner.json(owner.get(searchPath(workspaceId))).size());
        org.mockito.Mockito.doCallRealMethod().when(embeddings).embedDocuments(org.mockito.ArgumentMatchers.anyList());
        dispatcher.dispatchAvailable();
        assertEquals("READY",owner.json(owner.get(sourcePath(id))).get("status").asString());
        assertEquals(2,jdbc.queryForObject("SELECT attempt_count FROM processing_jobs WHERE resource_id=?",Integer.class,UUID.fromString(id)));
        assertEquals(2,jdbc.queryForObject("SELECT count(*) FROM source_chunk_embeddings",Integer.class));
        assertEquals(1,jdbc.queryForObject("SELECT count(*) FROM source_extraction_runs",Integer.class));
    }

    @Test void indexFailureRollsBackAndDoesNotMarkSourceReady() throws Exception {
        String id = upload("lecture.pdf",fixture("lecture.pdf"));
        jdbc.execute("CREATE FUNCTION suppress_index() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NULL; END; $$");
        jdbc.execute("CREATE TRIGGER suppress_index BEFORE INSERT ON source_chunk_embeddings FOR EACH ROW EXECUTE FUNCTION suppress_index()");
        try {
            var policy = new ProcessingProperties(); policy.getDispatcher().setMaxAttempts(1);
            new ProcessingJobDispatcher(queue,worker,listeners,policy,Clock.systemUTC(),transactionManager).dispatchAvailable();
            assertEquals("FAILED",owner.json(owner.get(sourcePath(id))).get("status").asString());
            assertEquals("INDEX",owner.json(owner.get(sourcePath(id) + "/processing")).get("stage").asString());
            for (String table : List.of("source_extractions","source_extraction_runs","source_retrieval_sets","source_chunk_embeddings","retrieval_embedding_models"))
                assertEquals(0,jdbc.queryForObject("SELECT count(*) FROM " + table,Integer.class));
            assertEquals(0,owner.json(owner.get(searchPath(workspaceId))).size());
        } finally {
            jdbc.execute("DROP TRIGGER suppress_index ON source_chunk_embeddings"); jdbc.execute("DROP FUNCTION suppress_index()");
        }
        assertEquals(202,owner.postJson(sourcePath(id) + "/reprocess","{}").statusCode()); dispatch();
        assertEquals(2,owner.json(owner.get(searchPath(workspaceId))).size());
    }

    @Test void aNewEmbeddingNamespaceRequiresExplicitRebuildAndNeverMixesDimensions() throws Exception {
        String id = upload("lecture.pdf",fixture("lecture.pdf")); dispatch();
        var replacement = new dev.researchhub.ai.application.EmbeddingModel("alternate","test-model","2",2);
        var query = new dev.researchhub.ai.application.EmbeddingBatch(replacement,List.of(List.of(1.0,0.0)));
        assertEquals(0,retrievalIndex.search("Lecture",UUID.fromString(workspaceId),null,10,query).size());
        org.mockito.Mockito.doAnswer(invocation -> new dev.researchhub.ai.application.EmbeddingBatch(replacement,
            java.util.Collections.nCopies(((List<?>)invocation.getArgument(0)).size(),List.of(1.0,0.0))))
            .when(embeddings).embedDocuments(org.mockito.ArgumentMatchers.anyList());
        assertEquals(202,owner.postJson(sourcePath(id) + "/reprocess","{}").statusCode()); dispatch();
        assertEquals(0,owner.json(owner.get(searchPath(workspaceId))).size()); // old provider's space cannot see new vectors
        var hits = retrievalIndex.search("Lecture",UUID.fromString(workspaceId),null,10,query);
        assertEquals(2,hits.size()); assertTrue(hits.stream().allMatch(h -> h.model().equals(replacement)));
        assertThrows(org.springframework.dao.DataIntegrityViolationException.class, () ->
            jdbc.update("UPDATE source_chunk_embeddings SET embedding='[1,0,0]'::public.vector WHERE source_id=?",UUID.fromString(id)));
        assertEquals(2,jdbc.queryForObject("SELECT count(*) FROM source_chunk_embeddings WHERE dimension=2",Integer.class));
    }

}
