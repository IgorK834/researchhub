package dev.researchhub.analysis.api;

import dev.researchhub.shared.infrastructure.persistence.PostgresTestcontainersConfiguration;
import dev.researchhub.source.SourceRowFixture;
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
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.TestPropertySource;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * RH-131 over real HTTP and PostgreSQL, without the Python worker: the persisted extraction profile of an immutable
 * version is what the preview is built from, so rows are seeded from the shared processing fixtures.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@ActiveProfiles("local")
@TestPropertySource(properties = {
        "researchhub.sources.storage.adapter=in-memory",
        "researchhub.processing.dispatcher.enabled=false"
})
@Import({PostgresTestcontainersConfiguration.class, DatasetPreviewApiIntegrationTest.Storage.class})
class DatasetPreviewApiIntegrationTest {

    @TestConfiguration(proxyBeanMethods = false)
    static class Storage {
        @Bean
        SourceStorage sourceStorage() {
            return new InMemorySourceStorage();
        }
    }

    private static final Path CONTRACTS = Path.of("../contracts");

    @Value("${local.server.port}")
    private int port;
    @Autowired
    private ObjectMapper json;
    @Autowired
    private JdbcTemplate jdbc;

    private ApiBrowser owner;
    private UUID ownerId;
    private UUID workspaceId;

    @BeforeEach
    void workspaceWithAnOwner() throws Exception {
        jdbc.execute("TRUNCATE users, workspaces CASCADE");
        owner = new ApiBrowser(port, json);
        ownerId = UUID.fromString(owner.signUp("owner@example.com", "Owner"));
        workspaceId = UUID.fromString(owner.createdWorkspaceId("Lab", "Data"));
    }

    private JsonNode fixture(String relative) throws Exception {
        return json.readTree(Files.readString(CONTRACTS.resolve(relative)));
    }

    /** A READY version of a tabular source whose archived extraction carries {@code workbook}. */
    private UUID[] seed(String type, String filename, JsonNode workbook, String status) {
        UUID sourceId = UUID.randomUUID();
        String media = type.equals("CSV") ? "text/csv"
                : type.equals("XLSX") ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                : "application/pdf";
        UUID versionId = SourceRowFixture.insert(jdbc, sourceId, workspaceId, ownerId, filename, filename, media, type,
                2048, "sources/" + sourceId, "ab".repeat(32), status, null, Instant.now());
        if (workbook != null) {
            UUID jobId = UUID.randomUUID();
            jdbc.update("""
                    INSERT INTO processing_jobs(id, workspace_id, job_type, resource_type, resource_id, status,
                        attempt_count, created_at, started_at, finished_at)
                    VALUES (?, ?, 'SOURCE_INGEST', 'SOURCE', ?, 'SUCCEEDED', 1, now(), now(), now())
                    """, jobId, workspaceId, sourceId);
            var payload = json.createObjectNode();
            payload.set("workbook", workbook);
            jdbc.update("""
                    INSERT INTO source_version_extractions(source_version_id, source_id, workspace_id, job_id,
                        parser_version, content_sha256, payload, created_at, processing_version, schema_version)
                    VALUES (?, ?, ?, ?, 'test', ?, ?::jsonb, now(), 'source-ingest-4', '4.0')
                    """, versionId, sourceId, workspaceId, jobId, "ab".repeat(32), json.writeValueAsString(payload));
        }
        return new UUID[]{sourceId, versionId};
    }

    private String path(UUID source, UUID version) {
        return path(workspaceId, source, version);
    }

    private static String path(UUID workspace, UUID source, UUID version) {
        return "/api/workspaces/" + workspace + "/analysis/datasets/" + source + "/versions/" + version + "/preview";
    }

    @Test
    void servesTheBoundedStructureOfAVersionToAnyMemberWithoutCaching() throws Exception {
        JsonNode workbook = fixture("processing/v4/source-ingest-result-workbook.json").get("workbook");
        UUID[] ids = seed("XLSX", "measurements.xlsx", workbook, "READY");
        ApiBrowser viewer = new ApiBrowser(port, json);
        viewer.signUp("viewer@example.com", "Viewer");
        assertEquals(201, owner.postJson("/api/workspaces/" + workspaceId + "/members",
                "{\"email\":\"viewer@example.com\",\"role\":\"VIEWER\"}").statusCode());

        var response = viewer.get(path(ids[0], ids[1]));

        assertEquals(200, response.statusCode(), response.body());
        assertEquals("no-store", response.headers().firstValue("Cache-Control").orElseThrow());
        JsonNode preview = json.readTree(response.body());
        assertEquals(ids[1].toString(), preview.get("sourceVersionId").asString());
        assertEquals(ids[0].toString(), preview.get("sourceId").asString());
        assertEquals("measurements.xlsx", preview.get("originalFilename").asString());
        assertEquals(1, preview.get("versionNumber").asInt());
        assertEquals("XLSX", preview.get("format").asString());
        assertFalse(preview.get("formulasEvaluated").asBoolean());
        assertEquals(4, preview.get("sheets").size());
        assertEquals("=B2*2", preview.get("sheets").get(0).get("sampleRows").get(0).get("cells").get(2).asString());
        assertFalse(response.body().contains("storageKey"), "storage locations are never part of the contract");
        assertTrue(response.body().length() < 65_536);
    }

    @Test
    void aHostileWorkbookIsCappedNotRejectedAndNeverExceedsTheResponseBudget() throws Exception {
        JsonNode workbook = fixture("analysis/dataset-preview/v1/large-workbook.json");
        UUID[] ids = seed("XLSX", "large.xlsx", workbook, "READY");

        var response = owner.get(path(ids[0], ids[1]));

        assertEquals(200, response.statusCode(), response.body());
        assertTrue(response.body().getBytes(java.nio.charset.StandardCharsets.UTF_8).length < 65_536);
        JsonNode preview = json.readTree(response.body());
        assertTrue(preview.get("truncated").asBoolean());
        assertEquals(10, preview.get("sheets").size());
        boolean omitted = false;
        for (JsonNode warning : preview.get("warnings")) omitted |= warning.get("code").asString().equals("SHEETS_OMITTED");
        assertTrue(omitted);
    }

    @Test
    void aCsvVersionReportsExactCountsFromItsProfile() throws Exception {
        JsonNode workbook = fixture("processing/v4/source-ingest-result-csv.json").get("workbook");
        UUID[] ids = seed("CSV", "people.csv", workbook, "READY");

        JsonNode sheet = json.readTree(owner.get(path(ids[0], ids[1])).body()).get("sheets").get(0);

        assertEquals(2, sheet.get("dimensions").get("dataRowCount").asInt());
        assertFalse(sheet.get("dimensions").get("rowCountEstimated").asBoolean());
        assertEquals("INTEGER", sheet.get("columns").get(1).get("inferredType").asString());
        assertEquals(1, sheet.get("columns").get(1).get("missingValues").asInt());
    }

    @Test
    void membershipIsRequiredAndForeignOrUnsupportedVersionsAreHidden() throws Exception {
        JsonNode workbook = fixture("processing/v4/source-ingest-result-csv.json").get("workbook");
        UUID[] csv = seed("CSV", "people.csv", workbook, "READY");
        UUID[] pdf = seed("PDF", "paper.pdf", null, "READY");
        ApiBrowser outsider = new ApiBrowser(port, json);
        outsider.signUp("outsider@example.com", "Outsider");
        UUID otherWorkspace = UUID.fromString(owner.createdWorkspaceId("Other", "Other"));

        var hidden = outsider.get(path(csv[0], csv[1]));
        var missing = outsider.get(path(UUID.randomUUID(), UUID.randomUUID()));
        assertEquals(404, hidden.statusCode());
        assertEquals(outsider.json(missing).get("detail"), outsider.json(hidden).get("detail"));
        assertFalse(hidden.body().contains("people.csv"));
        assertEquals(401, new ApiBrowser(port, json).get(path(csv[0], csv[1])).statusCode());
        assertEquals(404, owner.get(path(otherWorkspace, csv[0], csv[1])).statusCode());
        assertEquals(404, owner.get(path(csv[0], pdf[1])).statusCode(), "a version belongs to exactly one source");
        assertEquals(404, owner.get(path(csv[0], UUID.randomUUID())).statusCode());
        var notTabular = owner.get(path(pdf[0], pdf[1]));
        assertEquals(400, notTabular.statusCode(), notTabular.body());
        assertEquals("VALIDATION_FAILED", owner.json(notTabular).get("code").asString());
    }

    @Test
    void anUnprocessedVersionOrOneWithoutAProfileIsAConflictNotAnEmptyPreview() throws Exception {
        JsonNode workbook = fixture("processing/v4/source-ingest-result-csv.json").get("workbook");
        UUID[] processing = seed("CSV", "later.csv", workbook, "PROCESSING");
        UUID[] unprofiled = seed("CSV", "bare.csv", null, "READY");
        UUID[] withoutWorkbook = seed("CSV", "null.csv", json.nullNode(), "READY");

        for (UUID[] ids : new UUID[][]{processing, unprofiled, withoutWorkbook}) {
            var response = owner.get(path(ids[0], ids[1]));
            assertEquals(409, response.statusCode(), response.body());
            assertEquals("CONFLICT", owner.json(response).get("code").asString());
        }
    }

    @Test
    void anOlderVersionKeepsItsOwnPreviewWhenANewVersionReplacesTheActiveOne() throws Exception {
        JsonNode first = fixture("processing/v4/source-ingest-result-csv.json").get("workbook");
        UUID[] ids = seed("CSV", "people.csv", first, "READY");
        String before = owner.get(path(ids[0], ids[1])).body();

        UUID second = SourceRowFixture.addVersion(jdbc, ids[0], 2, "people-v2.csv", "text/csv", "CSV", 4096,
                "sources/" + UUID.randomUUID(), "cd".repeat(32), "PROCESSING", Instant.now());

        assertEquals(before, owner.get(path(ids[0], ids[1])).body());
        assertEquals(409, owner.get(path(ids[0], second)).statusCode());
    }
}
