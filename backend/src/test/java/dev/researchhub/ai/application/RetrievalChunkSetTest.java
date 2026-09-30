package dev.researchhub.ai.application;

import dev.researchhub.ai.infrastructure.search.RetrievalSearchDocument;
import dev.researchhub.processing.infrastructure.WorkerJobResult;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ObjectNode;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

class RetrievalChunkSetTest {
    private final ObjectMapper mapper = new ObjectMapper();
    private WorkerJobResult fixture(String path) throws Exception { return mapper.readValue(Files.readString(Path.of("../contracts", path)), WorkerJobResult.class); }
    @Test void validatesPythonFixturesAndExactSearchSchemaIncludingUnicode() throws Exception {
        for (String path : List.of("processing/v4/source-ingest-result-success.json", "processing/v4/source-ingest-result-workbook.json",
                "retrieval/v1/unicode-extraction.json", "retrieval/v1/unicode-whitespace-extraction.json")) {
            var result = fixture(path); var set = result.retrieval();
            set.validate(result.workspaceId(), result.sourceId(), result.extraction());
            for (var chunk : set.chunks()) {
                assertEquals(mapper.valueToTree(chunk), mapper.valueToTree(RetrievalSearchDocument.from(chunk)));
                assertEquals(chunk.contentHash(), RetrievalIdentity.hash(chunk.content()));
            }
            assertEquals(set, mapper.readValue(mapper.writeValueAsString(set), RetrievalChunkSet.class));
        }
        var expected = mapper.readTree(Files.readString(Path.of("../contracts/retrieval/v1/chunk-set.json")));
        assertEquals(expected, mapper.readTree(mapper.writeValueAsString(fixture("processing/v4/source-ingest-result-success.json").retrieval())));
    }
    @Test void refusesForgeryAndIncompatibleVersionsBeforePersistence() throws Exception {
        var result = fixture("processing/v4/source-ingest-result-success.json");
        var tree = (ObjectNode) mapper.valueToTree(result.retrieval());
        List<java.util.function.Consumer<ObjectNode>> mutations = List.of(
            value -> value.put("schemaVersion", "2.0"), value -> value.put("workspaceId", UUID.randomUUID().toString()),
            value -> value.put("sourceId", UUID.randomUUID().toString()), value -> value.put("sourceVersionId", UUID.randomUUID().toString()),
            value -> value.put("processingVersion", "old"), value -> value.put("sourceContentHash", "0".repeat(64)),
            value -> value.put("parserVersion", "old"), value -> value.put("ingestionVersion", "old"),
            value -> value.put("extractionContentHash", "0".repeat(64)), value -> value.putNull("chunks"),
            value -> value.putArray("chunks"), value -> ((ObjectNode) value.get("config")).put("maxCharacters", 31),
            value -> ((ObjectNode) value.get("config")).put("version", "unknown"),
            value -> ((ObjectNode) value.get("chunks").get(0)).put("content", "forged"),
            value -> ((ObjectNode) value.get("chunks").get(0)).put("contentHash", "0".repeat(64)),
            value -> ((ObjectNode) value.get("chunks").get(0)).put("chunkId", "0".repeat(64)),
            value -> ((ObjectNode) value.get("chunks").get(0)).put("chunkIndex", 1),
            value -> ((ObjectNode) value.get("chunks").get(0)).put("pageStart", 2),
            value -> ((ObjectNode) value.get("chunks").get(0)).put("sectionTitle", "forged"),
            value -> ((ObjectNode) value.get("chunks").get(0).get("spans").get(0)).put("unitId", "missing"),
            value -> ((ObjectNode) value.get("chunks").get(0).get("spans").get(0)).put("characterEnd", 999999)
        );
        for (var mutation : mutations) {
            var changed = tree.deepCopy(); mutation.accept(changed);
            assertThrows(IllegalArgumentException.class, () -> mapper.treeToValue(changed, RetrievalChunkSet.class)
                    .validate(result.workspaceId(), result.sourceId(), result.extraction()));
        }
    }
    @Test void configurationAndSearchRequireExplicitScopes() throws Exception {
        for (var config : List.of(new ChunkingConfig("hierarchical-char-1",1600,-1,200),
                new ChunkingConfig("hierarchical-char-1",1600,801,200),new ChunkingConfig("hierarchical-char-1",1600,100,1501))) {
            assertThrows(IllegalArgumentException.class, config::validate);
        }
        var chunk = fixture("processing/v4/source-ingest-result-success.json").retrieval().chunks().getFirst();
        assertThrows(IllegalArgumentException.class, () -> RetrievalSearchDocument.from(new RetrievalChunk(
                chunk.chunkId(),chunk.sourceId(),null,null,0,chunk.content(),1,1,null,chunk.contentHash(),chunk.processingVersion(),chunk.spans())));
    }
}
