package dev.researchhub.source.api;

import dev.researchhub.shared.infrastructure.persistence.PostgresTestcontainersConfiguration;
import dev.researchhub.source.application.InMemorySourceStorage;
import dev.researchhub.source.application.SourceStorage;
import dev.researchhub.support.ApiBrowser;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.http.ContentDisposition;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.TestPropertySource;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** Source upload security, validation, persistence, and read-back over the real HTTP stack. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@ActiveProfiles("local")
@TestPropertySource(properties = {
        "researchhub.sources.storage.adapter=in-memory",
        "researchhub.sources.max-size-bytes=64",
        "spring.servlet.multipart.max-file-size=64B",
        "spring.servlet.multipart.max-request-size=2KB",
        "researchhub.processing.dispatcher.enabled=false"
})
@Import({PostgresTestcontainersConfiguration.class, SourceApiIntegrationTest.StorageConfiguration.class})
class SourceApiIntegrationTest {

    @TestConfiguration(proxyBeanMethods = false)
    static class StorageConfiguration {
        @Bean
        SourceStorage sourceStorage() {
            return new InMemorySourceStorage();
        }
    }

    private static final byte[] PDF = "%PDF-1.7\n%%EOF\n".getBytes(StandardCharsets.US_ASCII);
    private static final byte[] XLSX = {'P', 'K', 3, 4, 20, 0};
    private static final byte[] CSV = "name,value\na,1\n".getBytes(StandardCharsets.UTF_8);

    @Value("${local.server.port}")
    private int port;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @Autowired
    private SourceStorage storage;

    @BeforeEach
    void clearData() {
        ((InMemorySourceStorage) storage).clear();
        // Source versions are immutable (rows cannot be deleted), so a test reset truncates the whole workspace tree.
        jdbcTemplate.execute("TRUNCATE users, workspaces CASCADE");
    }

    private ApiBrowser browser() {
        return new ApiBrowser(port, objectMapper);
    }

    private record Owner(ApiBrowser browser, String workspaceId) {
    }

    private Owner ownerWithWorkspace() throws Exception {
        ApiBrowser owner = browser();
        owner.signUp("owner@example.com", "Owner");
        return new Owner(owner, owner.createdWorkspaceId("Source Lab", "Uploads"));
    }

    private ApiBrowser memberWithRole(Owner owner, String email, String role) throws Exception {
        ApiBrowser member = browser();
        member.signUp(email, "Member");
        HttpResponse<String> added = owner.browser().postJson(
                "/api/workspaces/" + owner.workspaceId() + "/members",
                """
                        {"email":"%s","role":"%s"}
                        """.formatted(email, role));
        assertEquals(201, added.statusCode(), added.body());
        return member;
    }

    private static String sourcesPath(String workspaceId) {
        return "/api/workspaces/" + workspaceId + "/sources";
    }

    private int sourceRows() {
        Integer count = jdbcTemplate.queryForObject("SELECT count(*) FROM sources", Integer.class);
        return count == null ? 0 : count;
    }

    @Test
    void pdfXlsxAndCsvUploadsSucceedAndContentCanBeReadBack() throws Exception {
        Owner owner = ownerWithWorkspace();
        List<UploadCase> cases = List.of(
                new UploadCase("report.pdf", "application/pdf", PDF, "PDF"),
                new UploadCase("data.xlsx",
                        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", XLSX, "XLSX"),
                new UploadCase("data.csv", "text/csv", CSV, "CSV"));

        String pdfId = null;
        for (UploadCase upload : cases) {
            HttpResponse<String> response = owner.browser().postFile(sourcesPath(owner.workspaceId()),
                    upload.filename(), upload.mediaType(), upload.bytes());
            assertEquals(201, response.statusCode(), response.body());
            JsonNode source = owner.browser().json(response);
            assertEquals(upload.type(), source.get("sourceType").asString());
            assertEquals("UPLOADED", source.get("status").asString());
            assertTrue(source.get("failureSummary").isNull());
            assertFalse(source.has("storageKey"), "storage locations are never a public capability");
            if (upload.type().equals("PDF")) {
                pdfId = source.get("id").asString();
            }
        }

        assertEquals(3, sourceRows());
        HttpResponse<String> downloaded = owner.browser().get(
                sourcesPath(owner.workspaceId()) + "/" + pdfId + "/content");
        assertEquals(200, downloaded.statusCode(), downloaded.body());
        assertEquals(new String(PDF, StandardCharsets.US_ASCII), downloaded.body());

        HttpResponse<String> listed = owner.browser().get(sourcesPath(owner.workspaceId()));
        assertEquals(200, listed.statusCode(), listed.body());
        assertEquals(3, owner.browser().json(listed).size());
    }

    @Test
    void viewerCanBrowseMetadataAndDownloadWithASafeFilename() throws Exception {
        Owner owner = ownerWithWorkspace();
        HttpResponse<String> uploaded = owner.browser().postFile(sourcesPath(owner.workspaceId()),
                "Quarterly report.pdf", "application/pdf", PDF);
        String sourceId = owner.browser().json(uploaded).get("id").asString();
        jdbcTemplate.update("""
                UPDATE sources
                SET status = 'FAILED', failure_summary = 'The PDF is password protected.', updated_at = now()
                WHERE id = ?
                """, UUID.fromString(sourceId));
        ApiBrowser viewer = memberWithRole(owner, "reader@example.com", "VIEWER");

        HttpResponse<String> listed = viewer.get(sourcesPath(owner.workspaceId()));
        HttpResponse<String> detail = viewer.get(sourcesPath(owner.workspaceId()) + "/" + sourceId);
        HttpResponse<String> content = viewer.get(sourcesPath(owner.workspaceId()) + "/" + sourceId + "/content");

        assertEquals(200, listed.statusCode(), listed.body());
        assertEquals(1, viewer.json(listed).size());
        assertFalse(viewer.json(listed).get(0).has("storageKey"));
        assertFalse(viewer.json(listed).get(0).has("content"), "the metadata list never embeds file bytes");
        assertEquals("FAILED", viewer.json(listed).get(0).get("status").asString());
        assertEquals("The PDF is password protected.",
                viewer.json(listed).get(0).get("failureSummary").asString());

        assertEquals(200, detail.statusCode(), detail.body());
        assertEquals(sourceId, viewer.json(detail).get("id").asString());
        assertEquals("The PDF is password protected.", viewer.json(detail).get("failureSummary").asString());

        assertEquals(200, content.statusCode(), content.body());
        assertEquals("application/pdf", content.headers().firstValue("Content-Type").orElseThrow());
        assertEquals("private, no-store", content.headers().firstValue("Cache-Control").orElseThrow());
        assertEquals("nosniff", content.headers().firstValue("X-Content-Type-Options").orElseThrow());
        String dispositionHeader = content.headers().firstValue("Content-Disposition").orElseThrow();
        assertEquals("Quarterly report.pdf", ContentDisposition.parse(dispositionHeader).getFilename());
        assertFalse(dispositionHeader.contains("\r"));
        assertFalse(dispositionHeader.contains("\n"));
        assertEquals(new String(PDF, StandardCharsets.US_ASCII), content.body());
    }

    @Test
    void editorCanUploadButViewerIsDeniedBeforeAnythingIsStored() throws Exception {
        Owner owner = ownerWithWorkspace();
        ApiBrowser editor = memberWithRole(owner, "editor@example.com", "EDITOR");
        ApiBrowser viewer = memberWithRole(owner, "viewer@example.com", "VIEWER");

        HttpResponse<String> accepted = editor.postFile(sourcesPath(owner.workspaceId()),
                "editor.csv", "text/csv", CSV);
        HttpResponse<String> denied = viewer.postFile(sourcesPath(owner.workspaceId()),
                "viewer.csv", "text/csv", CSV);

        assertEquals(201, accepted.statusCode(), accepted.body());
        assertEquals(403, denied.statusCode(), denied.body());
        assertEquals("FORBIDDEN", viewer.json(denied).get("code").asString());
        assertEquals(1, sourceRows());
        assertEquals(1, ((InMemorySourceStorage) storage).objectCount());
    }

    @Test
    void oversizeAndUnsupportedUploadsFailPredictablyAndLeaveNoMetadata() throws Exception {
        Owner owner = ownerWithWorkspace();
        byte[] oversized = "x".repeat(65).getBytes(StandardCharsets.UTF_8);

        HttpResponse<String> tooLarge = owner.browser().postFile(sourcesPath(owner.workspaceId()),
                "large.txt", "text/plain", oversized);
        HttpResponse<String> unsupported = owner.browser().postFile(sourcesPath(owner.workspaceId()),
                "program.exe", "application/octet-stream", new byte[]{'M', 'Z'});

        assertEquals(413, tooLarge.statusCode(), tooLarge.body());
        assertEquals("PAYLOAD_TOO_LARGE", owner.browser().json(tooLarge).get("code").asString());
        assertEquals(415, unsupported.statusCode(), unsupported.body());
        assertEquals("UNSUPPORTED_FILE_TYPE", owner.browser().json(unsupported).get("code").asString());
        assertEquals(0, sourceRows());
        assertEquals(0, ((InMemorySourceStorage) storage).objectCount());
    }

    @Test
    void aCrossWorkspaceUploadAttemptIsIndistinguishableFromAMissingWorkspace() throws Exception {
        Owner owner = ownerWithWorkspace();
        ApiBrowser outsider = browser();
        outsider.signUp("outsider@example.com", "Outsider");

        HttpResponse<String> denied = outsider.postFile(sourcesPath(owner.workspaceId()),
                "stolen.csv", "text/csv", CSV);
        HttpResponse<String> missing = outsider.get(sourcesPath(UUID.randomUUID().toString()));

        assertEquals(404, denied.statusCode(), denied.body());
        assertEquals("RESOURCE_NOT_FOUND", outsider.json(denied).get("code").asString());
        assertEquals(outsider.json(missing).get("detail").asString(),
                outsider.json(denied).get("detail").asString());
        assertEquals(0, sourceRows());
    }

    @Test
    void nonMemberCannotInferSourceFromListDetailOrContent() throws Exception {
        Owner owner = ownerWithWorkspace();
        HttpResponse<String> uploaded = owner.browser().postFile(sourcesPath(owner.workspaceId()),
                "private.csv", "text/csv", CSV);
        String sourceId = owner.browser().json(uploaded).get("id").asString();
        ApiBrowser outsider = browser();
        outsider.signUp("no-access@example.com", "No Access");
        String missingSourceId = UUID.randomUUID().toString();

        List<HttpResponse<String>> denied = List.of(
                outsider.get(sourcesPath(owner.workspaceId())),
                outsider.get(sourcesPath(owner.workspaceId()) + "/" + sourceId),
                outsider.get(sourcesPath(owner.workspaceId()) + "/" + sourceId + "/content"));
        HttpResponse<String> missing = outsider.get(sourcesPath(owner.workspaceId()) + "/" + missingSourceId);

        for (HttpResponse<String> response : denied) {
            assertEquals(404, response.statusCode(), response.body());
            assertEquals("RESOURCE_NOT_FOUND", outsider.json(response).get("code").asString());
            assertEquals(outsider.json(missing).get("detail").asString(),
                    outsider.json(response).get("detail").asString());
            assertFalse(response.body().contains("private.csv"));
        }
    }


    // --- RH-130: immutable versions over HTTP ---

    /** Finishes the durable run so the source is READY, as the dispatcher would once the worker succeeds. */
    private void markReady(String sourceId) {
        jdbcTemplate.update("UPDATE source_versions SET status = 'READY', updated_at = now() WHERE id = "
                + "(SELECT active_version_id FROM sources WHERE id = ?)", UUID.fromString(sourceId));
        jdbcTemplate.update("UPDATE sources SET status = 'READY', updated_at = now() WHERE id = ?",
                UUID.fromString(sourceId));
        jdbcTemplate.update("""
                UPDATE processing_jobs SET status = 'SUCCEEDED', attempt_count = 1, started_at = created_at,
                    finished_at = created_at, next_attempt_at = NULL
                WHERE resource_id = ? AND status = 'PENDING'
                """, UUID.fromString(sourceId));
    }

    private String uploadedCsv(Owner owner, String name, String body) throws Exception {
        HttpResponse<String> response = owner.browser().postFile(sourcesPath(owner.workspaceId()), name, "text/csv",
                body.getBytes(StandardCharsets.UTF_8));
        assertEquals(201, response.statusCode(), response.body());
        return owner.browser().json(response).get("id").asString();
    }

    @Test
    void replacingCreatesAnImmutableVersionAndTheEarlierBytesRemainDownloadable() throws Exception {
        Owner owner = ownerWithWorkspace();
        String sourceId = uploadedCsv(owner, "measurements.csv", "t,v\n1,2\n");
        markReady(sourceId);
        String base = sourcesPath(owner.workspaceId()) + "/" + sourceId;
        JsonNode first = owner.browser().json(owner.browser().get(base));
        String firstVersionId = first.get("activeVersionId").asString();
        assertEquals(1, first.get("activeVersionNumber").asInt());

        HttpResponse<String> replaced = owner.browser().postFile(base + "/versions", "measurements-rev2.csv",
                "text/csv", "t,v\n1,2\n3,4\n".getBytes(StandardCharsets.UTF_8));

        assertEquals(201, replaced.statusCode(), replaced.body());
        JsonNode second = owner.browser().json(replaced);
        assertEquals(sourceId, second.get("id").asString(), "the source keeps its identity");
        assertEquals(2, second.get("activeVersionNumber").asInt());
        assertEquals("measurements-rev2.csv", second.get("originalFilename").asString());
        assertEquals("UPLOADED", second.get("status").asString());
        assertFalse(second.has("storageKey"));
        String secondVersionId = second.get("activeVersionId").asString();
        assertFalse(secondVersionId.equals(firstVersionId));

        // Active content is the latest bytes; version 1 is still the exact original bytes.
        assertEquals("t,v\n1,2\n3,4\n", owner.browser().get(base + "/content").body());
        HttpResponse<String> original = owner.browser().get(base + "/versions/" + firstVersionId + "/content");
        assertEquals(200, original.statusCode(), original.body());
        assertEquals("t,v\n1,2\n", original.body());
        assertEquals("text/csv", original.headers().firstValue("Content-Type").orElseThrow());
        assertEquals("private, no-store", original.headers().firstValue("Cache-Control").orElseThrow());
        assertEquals("nosniff", original.headers().firstValue("X-Content-Type-Options").orElseThrow());
        assertEquals("measurements.csv", ContentDisposition
                .parse(original.headers().firstValue("Content-Disposition").orElseThrow()).getFilename());
        assertEquals(2, ((InMemorySourceStorage) storage).objectCount());

        JsonNode versions = owner.browser().json(owner.browser().get(base + "/versions"));
        assertEquals(2, versions.size());
        assertEquals(secondVersionId, versions.get(0).get("id").asString());
        assertTrue(versions.get(0).get("active").asBoolean());
        assertFalse(versions.get(1).get("active").asBoolean());
        assertEquals("READY", versions.get(1).get("status").asString());
        assertEquals(1, versions.get(1).get("versionNumber").asInt());
        assertFalse(versions.get(0).has("storageKey"));

        JsonNode one = owner.browser().json(owner.browser().get(base + "/versions/" + firstVersionId));
        assertEquals(firstVersionId, one.get("id").asString());
        assertEquals(64, one.get("contentSha256").asString().length());

        // Both runs are durably bound to the version they were created for.
        assertEquals(secondVersionId, jdbcTemplate.queryForObject("""
                SELECT b.source_version_id FROM processing_jobs j
                JOIN processing_job_source_versions b ON b.job_id = j.id
                WHERE j.resource_id = ? AND j.generation = 1
                """, String.class, UUID.fromString(sourceId)));
    }

    @Test
    void replacingRequiresEditAccessAndAReadyOrFailedSource() throws Exception {
        Owner owner = ownerWithWorkspace();
        String sourceId = uploadedCsv(owner, "data.csv", "a\n1\n");
        String base = sourcesPath(owner.workspaceId()) + "/" + sourceId + "/versions";
        ApiBrowser viewer = memberWithRole(owner, "viewer@example.com", "VIEWER");
        ApiBrowser outsider = browser();
        outsider.signUp("outsider@example.com", "Outsider");
        byte[] next = "a\n2\n".getBytes(StandardCharsets.UTF_8);

        HttpResponse<String> notReady = owner.browser().postFile(base, "data2.csv", "text/csv", next);
        assertEquals(409, notReady.statusCode(), notReady.body());
        assertEquals("CONFLICT", owner.browser().json(notReady).get("code").asString());

        markReady(sourceId);
        HttpResponse<String> viewerDenied = viewer.postFile(base, "data2.csv", "text/csv", next);
        HttpResponse<String> outsiderDenied = outsider.postFile(base, "data2.csv", "text/csv", next);
        HttpResponse<String> unsupported = owner.browser().postFile(base, "run.exe", "application/octet-stream",
                new byte[]{'M', 'Z'});
        HttpResponse<String> oversized = owner.browser().postFile(base, "big.txt", "text/plain",
                "x".repeat(65).getBytes(StandardCharsets.UTF_8));
        HttpResponse<String> unknownSource = owner.browser().postFile(sourcesPath(owner.workspaceId()) + "/"
                + UUID.randomUUID() + "/versions", "data2.csv", "text/csv", next);

        assertEquals(403, viewerDenied.statusCode(), viewerDenied.body());
        assertEquals(404, outsiderDenied.statusCode(), outsiderDenied.body());
        assertEquals(415, unsupported.statusCode(), unsupported.body());
        assertEquals(413, oversized.statusCode(), oversized.body());
        assertEquals(404, unknownSource.statusCode(), unknownSource.body());
        assertEquals(1, ((InMemorySourceStorage) storage).objectCount(), "refused revisions leave no bytes");
        assertEquals(1, jdbcTemplate.queryForObject("SELECT count(*) FROM source_versions", Integer.class));
    }

    @Test
    void versionReadsAreWorkspaceScopedAndHideForeignVersions() throws Exception {
        Owner owner = ownerWithWorkspace();
        String sourceId = uploadedCsv(owner, "data.csv", "a\n1\n");
        String otherSourceId = uploadedCsv(owner, "other.csv", "z\n9\n");
        String versionId = owner.browser().json(owner.browser().get(sourcesPath(owner.workspaceId()) + "/" + sourceId))
                .get("activeVersionId").asString();
        String otherVersionId = owner.browser().json(owner.browser().get(sourcesPath(owner.workspaceId()) + "/"
                + otherSourceId)).get("activeVersionId").asString();
        ApiBrowser outsider = browser();
        outsider.signUp("outsider@example.com", "Outsider");
        ApiBrowser viewer = memberWithRole(owner, "viewer@example.com", "VIEWER");
        String base = sourcesPath(owner.workspaceId()) + "/" + sourceId + "/versions";

        for (String path : List.of(base, base + "/" + versionId, base + "/" + versionId + "/content")) {
            assertEquals(200, viewer.get(path).statusCode(), path);
            HttpResponse<String> hidden = outsider.get(path);
            assertEquals(404, hidden.statusCode(), path);
            assertFalse(hidden.body().contains("data.csv"));
        }
        // A version id belongs to exactly one source: another source's id answers like a missing one.
        assertEquals(404, owner.browser().get(base + "/" + otherVersionId).statusCode());
        assertEquals(404, owner.browser().get(base + "/" + otherVersionId + "/content").statusCode());
        assertEquals(404, owner.browser().get(base + "/" + UUID.randomUUID()).statusCode());
    }

    @Test
    void twoSimultaneousRevisionsProduceExactlyOneNewVersion() throws Exception {
        Owner owner = ownerWithWorkspace();
        String sourceId = uploadedCsv(owner, "data.csv", "a\n1\n");
        markReady(sourceId);
        String base = sourcesPath(owner.workspaceId()) + "/" + sourceId + "/versions";
        java.util.concurrent.CountDownLatch start = new java.util.concurrent.CountDownLatch(1);
        var pool = java.util.concurrent.Executors.newFixedThreadPool(2);
        try {
            List<java.util.concurrent.Future<Integer>> results = new java.util.ArrayList<>();
            for (int i = 0; i < 2; i++) {
                byte[] body = ("a\n" + (10 + i) + "\n").getBytes(StandardCharsets.UTF_8);
                results.add(pool.submit(() -> {
                    start.await();
                    return owner.browser().postFile(base, "racing.csv", "text/csv", body).statusCode();
                }));
            }
            start.countDown();
            List<Integer> statuses = new java.util.ArrayList<>();
            for (var result : results) {
                statuses.add(result.get(30, java.util.concurrent.TimeUnit.SECONDS));
            }
            java.util.Collections.sort(statuses);
            assertEquals(List.of(201, 409), statuses);
        } finally {
            pool.shutdownNow();
        }

        assertEquals(2, jdbcTemplate.queryForObject("SELECT count(*) FROM source_versions", Integer.class));
        assertEquals(2, ((InMemorySourceStorage) storage).objectCount(), "the losing request's bytes are removed");
        assertEquals(2, jdbcTemplate.queryForObject(
                "SELECT active_version_number FROM sources WHERE id = ?", Integer.class, UUID.fromString(sourceId)));
    }

    @Test
    void sourcesCarryTheirActiveVersionInEveryRead() throws Exception {
        Owner owner = ownerWithWorkspace();
        String sourceId = uploadedCsv(owner, "data.csv", "a\n1\n");

        JsonNode listed = owner.browser().json(owner.browser().get(sourcesPath(owner.workspaceId()))).get(0);
        JsonNode detail = owner.browser().json(owner.browser().get(sourcesPath(owner.workspaceId()) + "/" + sourceId));

        for (JsonNode source : List.of(listed, detail)) {
            assertEquals(1, source.get("activeVersionNumber").asInt());
            assertEquals(36, source.get("activeVersionId").asString().length());
        }
    }

    private record UploadCase(String filename, String mediaType, byte[] bytes, String type) {
    }

}
