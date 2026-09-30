package dev.researchhub.ai.application;

import org.junit.jupiter.api.Test;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

class EmbeddingContractTest {
    private final EmbeddingModel model = new EmbeddingModel("test","model","1",2);
    @Test void readsTheSharedPythonJavaContract() throws Exception {
        var batch = new tools.jackson.databind.ObjectMapper().readValue(
            java.nio.file.Files.readString(java.nio.file.Path.of("../contracts/embeddings/v1/batch.json")), EmbeddingBatch.class);
        assertEquals(model,batch.metadata()); batch.requireCount(2);
        assertEquals(List.of(1.0,0.0),batch.vectors().getFirst());
    }
    @Test void modelIdentityIncludesProviderNameVersionAndDimension() {
        var identities = List.of(model,new EmbeddingModel("other","model","1",2),new EmbeddingModel("test","other","1",2),
            new EmbeddingModel("test","model","2",2),new EmbeddingModel("test","model","1",3));
        assertEquals(5,identities.stream().map(EmbeddingModel::indexId).distinct().count());
        assertThrows(IllegalArgumentException.class,() -> new EmbeddingModel(null,"model","1",2));
        assertThrows(IllegalArgumentException.class,() -> new EmbeddingModel("test"," ","1",2));
        assertThrows(IllegalArgumentException.class,() -> new EmbeddingModel("test","model","v".repeat(129),2));
        assertThrows(IllegalArgumentException.class,() -> new EmbeddingModel("test","model","1",0));
        assertThrows(IllegalArgumentException.class,() -> new EmbeddingModel("test","model","1",4097));
    }
    @Test void rejectsCountDimensionNonFiniteAndZeroVectorsAndMakesDefensiveCopies() {
        var vector = new ArrayList<>(List.of(1.0,0.0));
        var batch = new EmbeddingBatch(model,List.of(vector)); vector.set(0,0.0);
        assertEquals(1.0,batch.vectors().getFirst().getFirst());
        assertThrows(UnsupportedOperationException.class,() -> batch.vectors().getFirst().set(0,0.0));
        batch.requireCount(1); assertThrows(IllegalArgumentException.class,() -> batch.requireCount(2));
        for (var invalid : List.of(List.of(1.0),List.of(0.0,0.0),List.of(Double.NaN,1.0),List.of(Double.POSITIVE_INFINITY,1.0)))
            assertThrows(IllegalArgumentException.class,() -> new EmbeddingBatch(model,List.of(invalid)));
        assertThrows(IllegalArgumentException.class,() -> new EmbeddingBatch(null,List.of()));
        assertThrows(IllegalArgumentException.class,() -> new EmbeddingBatch(model,null));
        assertThrows(IllegalArgumentException.class,() -> new EmbeddingBatch(model,Collections.singletonList(null)));
        assertThrows(IllegalArgumentException.class,() -> new EmbeddingBatch(model,List.of(Arrays.asList(null,1.0))));
    }
}
