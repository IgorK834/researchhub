package dev.researchhub.processing.application;

import dev.researchhub.processing.infrastructure.WorkerJobResult;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ObjectNode;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;

class SourceExtractionTest {
    private final ObjectMapper mapper = new ObjectMapper();
    private WorkerJobResult result(String file) throws Exception {
        return mapper.readValue(Files.readString(Path.of("../contracts/processing/v2", file)), WorkerJobResult.class);
    }
    @Test void validatesSharedPdfAndWorkbookContracts() throws Exception {
        for (String file : new String[]{"source-ingest-result-success.json", "source-ingest-result-workbook.json"}) {
            var result = result(file);
            result.extraction().validate(result.sourceId());
        }
    }
    @Test void rejectsForgedIdentityRangesOrderingAndFormulaClaims() throws Exception {
        var fixture = result("source-ingest-result-success.json");
        var extraction = fixture.extraction();
        assertThrows(IllegalArgumentException.class, () -> extraction.validate(UUID.randomUUID()));
        var tree = (ObjectNode) mapper.valueToTree(extraction);
        for (String field : new String[]{"parserVersion", "extractionMetadata", "structure", "chunks", "warnings"}) {
            var changed = tree.deepCopy(); changed.putNull(field);
            assertThrows(IllegalArgumentException.class, () -> mapper.treeToValue(changed, SourceExtraction.class).validate(fixture.sourceId()));
        }
        var chunk = (ObjectNode) tree.get("chunks").get(0);
        for (String field : new String[]{"ordinal", "characterStart", "characterEnd", "pageNumber"}) {
            var changed = tree.deepCopy(); ((ObjectNode) changed.get("chunks").get(0)).put(field, -1);
            assertThrows(IllegalArgumentException.class, () -> mapper.treeToValue(changed, SourceExtraction.class).validate(fixture.sourceId()));
        }
        var changedText = tree.deepCopy(); ((ObjectNode) changedText.get("chunks").get(0)).put("text", chunk.get("text").asString() + "forged");
        assertThrows(IllegalArgumentException.class, () -> mapper.treeToValue(changedText, SourceExtraction.class).validate(fixture.sourceId()));
        var badHash = tree.deepCopy(); ((ObjectNode) badHash.get("extractionMetadata")).put("contentSha256", "invalid");
        assertThrows(IllegalArgumentException.class, () -> mapper.treeToValue(badHash, SourceExtraction.class).validate(fixture.sourceId()));
        var workbook = result("source-ingest-result-workbook.json");
        var workbookTree = (ObjectNode) mapper.valueToTree(workbook.extraction());
        ((ObjectNode) workbookTree.get("workbook").get("sheets").get(0)).put("formulaPresence", false);
        ((ObjectNode) workbookTree.get("workbook").get("sheets").get(0)).put("formulaScanComplete", false);
        assertThrows(IllegalArgumentException.class, () -> mapper.treeToValue(workbookTree, SourceExtraction.class).validate(workbook.sourceId()));
    }
    @Test void acceptsUnicodeCodePointRangesWithoutLosingProvenance() {
        var sourceId = UUID.randomUUID();
        var extraction = new SourceExtraction("unicode-1", new SourceExtraction.ExtractionMetadata(null, null, null, 0, 2, "a".repeat(64)),
                new SourceExtraction.DocumentStructure(java.util.List.of(), java.util.List.of()),
                java.util.List.of(new SourceExtraction.ExtractedChunk(sourceId, "unicode-1", null, "unit-0", 0, "λ😀", null, null, 0, 2)), null, java.util.List.of());
        extraction.validate(sourceId);
    }
}
