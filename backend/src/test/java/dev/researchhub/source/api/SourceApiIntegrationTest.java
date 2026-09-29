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
        "spring.servlet.multipart.max-request-size=2KB"
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
        jdbcTemplate.execute("DELETE FROM sources");
        jdbcTemplate.execute("DELETE FROM workspace_members");
        jdbcTemplate.execute("DELETE FROM workspaces");
        jdbcTemplate.execute("DELETE FROM users");
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

    private record UploadCase(String filename, String mediaType, byte[] bytes, String type) {
    }

}
