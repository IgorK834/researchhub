package dev.researchhub.processing.application;

import dev.researchhub.processing.infrastructure.WorkerJobResult;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ObjectNode;
import java.nio.file.*;
import java.util.List;
import java.util.function.Consumer;
import static org.junit.jupiter.api.Assertions.*;

class CsvProfileTest {
    private final ObjectMapper json = new ObjectMapper();
    private WorkerJobResult fixture() throws Exception {
        return json.readValue(Files.readString(Path.of("../contracts/processing/v4/source-ingest-result-csv.json")), WorkerJobResult.class);
    }
    @Test void sharedCsvContractKeepsFileProvenanceAndVersionedProfile() throws Exception {
        var result = fixture();
        result.extraction().validate(result.sourceId());
        result.retrieval().validate(result.workspaceId(), result.sourceId(), result.extraction());
        var profile = result.workbook().csvProfile();
        assertEquals(2, profile.rowCount());
        assertEquals("SCHEMA_ONLY", profile.indexPolicy());
        assertEquals("integer", profile.columns().get(1).inferredType());
        assertEquals(1, profile.columns().get(1).missingCount());
        assertTrue(result.retrieval().chunks().stream().noneMatch(chunk -> chunk.content().contains("Ada")));
        assertEquals(json.readTree(Files.readString(Path.of("../contracts/tabular/v1/csv-profile.json"))), json.readTree(json.writeValueAsString(profile)));
        assertEquals(json.valueToTree(result), json.valueToTree(json.readValue(json.writeValueAsString(result), WorkerJobResult.class)));
    }
    @Test void legacyWorkbookJsonWithoutCsvMetadataRemainsReadable() throws Exception {
        var result = fixture();
        var tree = (ObjectNode) json.valueToTree(result.extraction());
        ((ObjectNode) tree.get("workbook")).remove("csvProfile");
        var legacy = json.treeToValue(tree, SourceExtraction.class);
        legacy.validate(result.sourceId());
        assertNull(legacy.workbook().csvProfile());
    }
    @Test void rejectsInconsistentCountsPoliciesColumnOrderNamesAndMissingSummaries() throws Exception {
        var result = fixture();
        var tree = (ObjectNode) json.valueToTree(result.extraction());
        List<Consumer<ObjectNode>> changes = List.of(
            p -> p.put("schemaVersion", "2.0"), p -> p.putNull("encoding"), p -> p.put("encoding", "guess"),
            p -> p.put("delimiter", "^"), p -> p.put("headerPolicy", "GUESS"), p -> p.put("missingValuePolicy", "NA"),
            p -> p.put("indexPolicy", "ALL_ROWS"), p -> p.put("rowCount", 20), p -> p.putNull("rowCount"),
            p -> p.put("profiledRowCount", -1), p -> p.put("rowScanComplete", false), p -> p.putNull("columns"),
            p -> p.putArray("columns"), p -> ((ObjectNode) p.get("columns").get(0)).put("columnNumber", 2),
            p -> ((ObjectNode) p.get("columns").get(0)).putNull("name"),
            p -> ((ObjectNode) p.get("columns").get(0)).put("name", " "),
            p -> ((ObjectNode) p.get("columns").get(0)).put("name", "x".repeat(501)),
            p -> ((ObjectNode) p.get("columns").get(1)).put("name", "name"),
            p -> ((ObjectNode) p.get("columns").get(0)).putNull("inferredType"),
            p -> ((ObjectNode) p.get("columns").get(0)).put("inferredType", "formula"),
            p -> ((ObjectNode) p.get("columns").get(0)).put("inferredType", "unknown"),
            p -> ((ObjectNode) p.get("columns").get(0)).put("missingCount", -1),
            p -> ((ObjectNode) p.get("columns").get(0)).put("missingCount", 3)
        );
        for (var mutate : changes) {
            var changed = tree.deepCopy(); mutate.accept((ObjectNode) changed.get("workbook").get("csvProfile"));
            assertThrows(IllegalArgumentException.class, () -> json.treeToValue(changed, SourceExtraction.class).validate(result.sourceId()));
        }
        for (String field : List.of("headerRow", "columnCount", "rowCountEstimate")) {
            var changed = tree.deepCopy(); ((ObjectNode) changed.get("workbook").get("sheets").get(0)).putNull(field);
            assertThrows(IllegalArgumentException.class, () -> json.treeToValue(changed, SourceExtraction.class).validate(result.sourceId()));
        }
        var changed = tree.deepCopy(); ((ObjectNode) changed.get("workbook").get("sheets").get(0)).put("name", "Foreign");
        assertThrows(IllegalArgumentException.class, () -> json.treeToValue(changed, SourceExtraction.class).validate(result.sourceId()));
    }
}
