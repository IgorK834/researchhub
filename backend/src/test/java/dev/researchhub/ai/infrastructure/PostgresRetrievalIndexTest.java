package dev.researchhub.ai.infrastructure;

import dev.researchhub.ai.application.*;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ObjectNode;
import java.nio.file.*;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

/** Fail closed before a scope error can reach a destructive projection replacement. */
class PostgresRetrievalIndexTest {
    private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
    private final ObjectMapper mapper = new ObjectMapper();
    private final PostgresRetrievalIndex index = new PostgresRetrievalIndex(jdbc,mapper);
    private final EmbeddingBatch batch = new EmbeddingBatch(new EmbeddingModel("test","model","1",2),List.of(List.of(1.0,0.0)));

    @Test void refusesForgedSourceWorkspaceVersionOrObsoleteJobBeforeDeletion() throws Exception {
        var original = (ObjectNode)mapper.readTree(Files.readString(Path.of("../contracts/retrieval/v1/chunk-set.json")));
        for (String field : List.of("workspaceId","sourceId","processingVersion")) {
            var tree = original.deepCopy();
            ((ObjectNode)tree.get("chunks").get(0)).put(field, field.equals("processingVersion") ? "old" : UUID.randomUUID().toString());
            assertThrows(IllegalArgumentException.class,() -> index.upsert(UUID.randomUUID(),mapper.treeToValue(tree,RetrievalChunkSet.class),batch));
        }
        for (String field : List.of("workspaceId","sourceId")) {
            var tree=original.deepCopy(); tree.putNull(field);
            assertThrows(IllegalArgumentException.class,() -> index.upsert(UUID.randomUUID(),mapper.treeToValue(tree,RetrievalChunkSet.class),batch));
        }
        verifyNoInteractions(jdbc);
        assertThrows(IllegalStateException.class,() -> index.upsert(UUID.randomUUID(),mapper.treeToValue(original,RetrievalChunkSet.class),batch));
        verify(jdbc,never()).update(anyString(),any(Object[].class));
    }
    @Test void refusesUnboundedOrMissingSearchScopeBeforeQuerying() {
        assertThrows(NullPointerException.class,() -> index.search("query",null,null,10,batch));
        for (String query : Arrays.asList(null," ")) assertThrows(IllegalArgumentException.class,() -> index.search(query,UUID.randomUUID(),null,10,batch));
        for (int topK : new int[]{0,51}) assertThrows(IllegalArgumentException.class,() -> index.search("query",UUID.randomUUID(),null,topK,batch));
        assertThrows(IllegalArgumentException.class,() -> index.search("query",UUID.randomUUID(),Collections.nCopies(101,UUID.randomUUID()),10,batch));
        verifyNoInteractions(jdbc);
    }
}
