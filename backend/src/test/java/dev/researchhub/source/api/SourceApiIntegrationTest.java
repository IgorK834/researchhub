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
        "researchhub.sources.max-size-bytes=1024",
        "spring.servlet.multipart.max-file-size=1024B",
        "spring.servlet.multipart.max-request-size=4KB",
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
    private static final byte[] XLSX = dev.researchhub.security.OfficeUploadFixture.xlsx();
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
        byte[] oversized = "x".repeat(1025).getBytes(StandardCharsets.UTF_8);

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
                "x".repeat(1025).getBytes(StandardCharsets.UTF_8));
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

    @Test
    void spoofedOfficePackagesArchivesAndBinaryTextLeaveNoBlobOrIngestionJob() throws Exception {
        Owner owner = ownerWithWorkspace();
        var zip = dev.researchhub.security.OfficeUploadFixture.archive(java.util.Map.of("payload.txt", "untrusted"));
        for (UploadCase upload : List.of(
                new UploadCase("renamed.docx", "application/octet-stream", XLSX, "DOCX"),
                new UploadCase("generic.xlsx", "application/octet-stream", zip, "XLSX"),
                new UploadCase("archive.zip", "application/octet-stream", zip, "ZIP"),
                new UploadCase("renamed.txt", "text/plain", zip, "TXT"),
                new UploadCase("truncated.xlsx", "application/octet-stream", new byte[]{'P','K',3,4}, "XLSX"),
                new UploadCase("macro.xlsm", "application/octet-stream", XLSX, "XLSM"))) {
            var response = owner.browser().postFile(sourcesPath(owner.workspaceId()),upload.filename(),upload.mediaType(),upload.bytes());
            assertEquals(415, response.statusCode(), response.body());
            assertEquals("UNSUPPORTED_FILE_TYPE", owner.browser().json(response).get("code").asString());
        }
        assertEquals(0, sourceRows());
        assertEquals(0, ((InMemorySourceStorage)storage).objectCount());
        assertEquals(0, jdbcTemplate.queryForObject("SELECT count(*) FROM processing_jobs",Integer.class));
    }

    @Test
    void pathLikeNameIsNormalizedAsMetadataWhileStorageKeyIsIndependent() throws Exception {
        Owner owner = ownerWithWorkspace();
        var response = owner.browser().postFile(sourcesPath(owner.workspaceId()), "../../private/claim.txt", "text/plain", "A claim".getBytes(StandardCharsets.UTF_8));
        assertEquals(201, response.statusCode(), response.body());
        assertEquals("claim.txt", owner.browser().json(response).get("originalFilename").asString());
        String key = jdbcTemplate.queryForObject("SELECT storage_key FROM sources",String.class);
        assertFalse(key.contains("claim")); assertFalse(key.contains("..")); assertFalse(key.contains("private"));
    }


    private static final String BIBLIOGRAPHY = """
            {"title":"  Photovoltaic efficiency  ","authors":[" Smith, J. ","Ada Lovelace"],
             "publicationYear":2025,"doi":"https://doi.org/10.1234/ABC","venue":" Journal of Energy ",
             "url":"https://example.org/paper","citationKey":"Smith2025"}
            """;
    private static final String ORGANIZATION = """
            {"displayName":" Cell study ","tags":[" Review ","review","ENERGY"],"collections":[" Papers "]}
            """;

    @Test
    void normalizedMetadataAndOrganizationPersistWithoutChangingImmutableEvidence() throws Exception {
        Owner owner = ownerWithWorkspace();
        String id = uploadedCsv(owner, "original.csv", "a\n1\n");
        String base = sourcesPath(owner.workspaceId()) + "/" + id;
        JsonNode before = owner.browser().json(owner.browser().get(base));
        var metadata = owner.browser().sendWithMethod("PUT", base + "/bibliography", BIBLIOGRAPHY);
        assertEquals(200, metadata.statusCode(), metadata.body());
        assertEquals("Photovoltaic efficiency", owner.browser().json(metadata).path("bibliography").path("title").asString());
        assertEquals("10.1234/abc", owner.browser().json(metadata).path("bibliography").path("doi").asString());
        var changed = owner.browser().sendWithMethod("PUT", base + "/organization", ORGANIZATION);
        assertEquals(200, changed.statusCode(), changed.body());
        JsonNode after = owner.browser().json(changed);
        for (String field : List.of("id", "workspaceId", "originalFilename", "contentSha256", "activeVersionId", "activeVersionNumber", "uploadedBy", "createdAt"))
            assertEquals(before.path(field), after.path(field), field);
        assertEquals("Cell study", after.path("displayName").asString());
        assertEquals("energy", after.path("tags").get(0).asString());
        assertEquals(2, after.path("tags").size());
        assertEquals("papers", after.path("collections").get(0).asString());
        assertEquals(after, owner.browser().json(owner.browser().get(base)));
        markReady(id);
        var replacement = owner.browser().postFile(base + "/versions", "new.csv", "text/csv", "a\n2\n".getBytes(StandardCharsets.UTF_8));
        assertEquals(201, replacement.statusCode(), replacement.body());
        assertEquals(after.path("bibliography"), owner.browser().json(replacement).path("bibliography"));
        assertEquals(after.path("tags"), owner.browser().json(replacement).path("tags"));
        assertEquals("a\n1\n", owner.browser().get(base + "/versions/" + before.path("activeVersionId").asString() + "/content").body());
        markReady(id);
        var reprocess = owner.browser().postJson(base + "/reprocess", "{}");
        assertEquals(202, reprocess.statusCode(), reprocess.body());
        assertEquals(after.path("bibliography"), owner.browser().json(reprocess).path("bibliography"));
    }

    @Test
    void detailWritesAreAuthorizedAndCsrfProtectedAndArchivedWorkspacesAreReadOnly() throws Exception {
        Owner owner = ownerWithWorkspace();
        String id = uploadedCsv(owner, "private.csv", "a\n1\n");
        String base = sourcesPath(owner.workspaceId()) + "/" + id;
        ApiBrowser viewer = memberWithRole(owner, "viewer@example.com", "VIEWER");
        ApiBrowser editor = memberWithRole(owner, "editor@example.com", "EDITOR");
        ApiBrowser outsider = browser(); outsider.signUp("outside@example.com", "Outside");
        for (String path : List.of("/bibliography", "/organization")) {
            String body = path.equals("/bibliography") ? BIBLIOGRAPHY : ORGANIZATION;
            assertEquals(403, viewer.sendWithMethod("PUT", base + path, body).statusCode());
            assertEquals(404, outsider.sendWithMethod("PUT", base + path, body).statusCode());
            assertEquals(403, owner.browser().sendWithoutCsrf("PUT", base + path, body).statusCode());
            assertEquals(200, editor.sendWithMethod("PUT", base + path, body).statusCode());
            String other = owner.browser().createdWorkspaceId("Other", "");
            assertEquals(404, owner.browser().sendWithMethod("PUT", sourcesPath(other) + "/" + id + path, body).statusCode());
        }
        var archived = owner.browser().postJson("/api/workspaces/" + owner.workspaceId() + "/archive", "{}");
        assertEquals(200, archived.statusCode(), archived.body());
        assertEquals(409, owner.browser().sendWithMethod("PUT", base + "/organization", ORGANIZATION).statusCode());
        assertEquals(409, owner.browser().sendWithMethod("PUT", base + "/bibliography", BIBLIOGRAPHY).statusCode());
        assertEquals(200, viewer.get(sourcesPath(owner.workspaceId()) + "/search").statusCode());
    }

    @Test
    void validationAndWorkspaceUniqueCitationKeysAreExplicit() throws Exception {
        Owner owner = ownerWithWorkspace();
        String first = uploadedCsv(owner, "first.csv", "a\n1\n");
        String second = uploadedCsv(owner, "second.csv", "a\n2\n");
        String base = sourcesPath(owner.workspaceId());
        assertEquals(200, owner.browser().sendWithMethod("PUT", base + "/" + first + "/bibliography", BIBLIOGRAPHY).statusCode());
        var duplicate = owner.browser().sendWithMethod("PUT", base + "/" + second + "/bibliography", BIBLIOGRAPHY.replace("Smith2025", "smith2025"));
        assertEquals(409, duplicate.statusCode(), duplicate.body());
        for (String body : List.of(BIBLIOGRAPHY.replace("2025,", "0,"), BIBLIOGRAPHY.replace("https://example.org/paper", "javascript:alert(1)"),
                BIBLIOGRAPHY.replace("https://doi.org/10.1234/ABC", "bad-doi"), "{\"authors\":null}", "{\"authors\":[\" \"]}")) {
            var rejected = owner.browser().sendWithMethod("PUT", base + "/" + first + "/bibliography", body);
            assertEquals(400, rejected.statusCode(), rejected.body());
            assertEquals("VALIDATION_FAILED", owner.browser().json(rejected).path("code").asString());
        }
        assertEquals(400, owner.browser().sendWithMethod("PUT", base + "/" + first + "/organization", ORGANIZATION.replace("Cell study", " ")).statusCode());
        String other = owner.browser().createdWorkspaceId("Other", "");
        String otherId = owner.browser().json(owner.browser().postFile(sourcesPath(other), "other.csv", "text/csv", CSV)).path("id").asString();
        assertEquals(200, owner.browser().sendWithMethod("PUT", sourcesPath(other) + "/" + otherId + "/bibliography", BIBLIOGRAPHY).statusCode());
        String empty = "{\"authors\":[],\"title\":null,\"publicationYear\":null,\"doi\":null,\"venue\":null,\"url\":null,\"citationKey\":null}";
        assertEquals(200, owner.browser().sendWithMethod("PUT", base + "/" + first + "/bibliography", empty).statusCode());
        assertEquals(200, owner.browser().sendWithMethod("PUT", base + "/" + first + "/organization", "{\"displayName\":\"clear\",\"tags\":[],\"collections\":[]}").statusCode());
    }

    @Test
    void searchCombinesFiltersUsesLiteralSubstringsAndKeepsCountsWorkspaceScoped() throws Exception {
        Owner owner = ownerWithWorkspace();
        String id = uploadedCsv(owner, "name_100%.csv", "a\n1\n");
        String base = sourcesPath(owner.workspaceId());
        owner.browser().sendWithMethod("PUT", base + "/" + id + "/bibliography", BIBLIOGRAPHY);
        owner.browser().sendWithMethod("PUT", base + "/" + id + "/organization", ORGANIZATION);
        markReady(id);
        uploadedCsv(owner, "other.csv", "a\n2\n");
        Owner outside = ownerWithAnotherWorkspace();
        uploadedCsv(outside, "Photovoltaic-private.csv", "a\n3\n");
        String uploader = owner.browser().json(owner.browser().get(base + "/" + id)).path("uploadedBy").asString();
        for (String query : List.of("query=PHOTOVOLTAIC", "query=Cell", "query=100%25", "query=_", "type=CSV&status=READY&uploader=" + uploader + "&tag=REVIEW&collection=Papers")) {
            var found = owner.browser().get(base + "/search?" + query);
            assertEquals(200, found.statusCode(), found.body());
            assertEquals(1, owner.browser().json(found).path("totalElements").asInt());
            assertEquals(id, owner.browser().json(found).path("items").get(0).path("id").asString());
        }
        var none = owner.browser().get(base + "/search?type=PDF&status=READY");
        assertEquals(0, owner.browser().json(none).path("totalElements").asInt());
        var first = owner.browser().json(owner.browser().get(base + "/search?size=1"));
        var next = owner.browser().json(owner.browser().get(base + "/search?size=1&page=1"));
        assertEquals(2, first.path("totalElements").asInt()); assertTrue(first.path("hasNext").asBoolean());
        assertFalse(next.path("hasNext").asBoolean());
        assertFalse(first.path("items").get(0).path("id").equals(next.path("items").get(0).path("id")));
        var facets = owner.browser().json(owner.browser().get(base + "/facets"));
        assertEquals(2, facets.path("total").asInt()); assertEquals(1, facets.path("ready").asInt());
        assertEquals(2, facets.path("types").path("CSV").asInt());
        assertEquals("papers", facets.path("collections").get(0).asString());
        assertEquals(404, outside.browser().get(base + "/search?query=private").statusCode());
        assertEquals(404, outside.browser().get(base + "/search?type=INVALID").statusCode());
        assertEquals(404, outside.browser().get(base + "/facets").statusCode());
        for (String query : List.of("type=WEB", "status=INVALID", "page=-1", "size=101", "uploader=invalid", "query=" + "a".repeat(201)))
            assertEquals(400, owner.browser().get(base + "/search?" + query).statusCode(), query);
    }

    private Owner ownerWithAnotherWorkspace() throws Exception {
        ApiBrowser other = browser(); other.signUp("other-owner@example.com", "Other");
        return new Owner(other, other.createdWorkspaceId("Private", ""));
    }


    @Test
    @org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable(named = "SOURCE_LIBRARY_BROWSER_TESTS", matches = "true")
    void productionBrowserEditsOrganizesFiltersAndPreservesSourceIdentity() throws Exception {
        Owner owner = ownerWithWorkspace();
        var uploaded = owner.browser().postFile(sourcesPath(owner.workspaceId()), "original.txt", "text/plain", "Research notes".getBytes(StandardCharsets.UTF_8));
        assertEquals(201, uploaded.statusCode(), uploaded.body());
        String id = owner.browser().json(uploaded).path("id").asString();
        for (int index = 0; index < 31; index++) uploadedCsv(owner, "data-" + index + ".csv", "a\n1\n");
        memberWithRole(owner, "viewer@example.com", "VIEWER");
        Owner other = ownerWithAnotherWorkspace();
        uploadedCsv(other, "private.csv", "a\n3\n");
        var builder = new ProcessBuilder("node", "e2e/source-library.cjs")
                .directory(java.nio.file.Path.of("../frontend").toFile());
        builder.environment().put("E2E_BACKEND_URL", "http://127.0.0.1:" + port);
        builder.environment().put("E2E_WORKSPACE_ID", owner.workspaceId());
        builder.environment().put("E2E_SOURCE_ID", id);
        builder.environment().put("E2E_OTHER_WORKSPACE_ID", other.workspaceId());
        var log = java.nio.file.Path.of("target/source-library-browser-e2e.log");
        var process = builder.redirectErrorStream(true).redirectOutput(log.toFile()).start();
        if (!process.waitFor(55, java.util.concurrent.TimeUnit.SECONDS)) {
            process.destroyForcibly(); org.junit.jupiter.api.Assertions.fail("Source library browser exceeded deadline");
        }
        assertEquals(0, process.exitValue(), java.nio.file.Files.readString(log));
    }

    private record UploadCase(String filename, String mediaType, byte[] bytes, String type) {
    }

}
