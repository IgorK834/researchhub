package dev.researchhub.ai.application;

import dev.researchhub.ai.application.SourceAnalysisContracts.*;
import static dev.researchhub.ai.application.SourceAnalysisContracts.DEFAULT_CRITERIA;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.ObjectMapper;
import java.nio.file.*;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

class SourceAnalysisContractTest {
    final ObjectMapper json=new ObjectMapper();
    @Test void javaAndPythonShareVersionedComparisonAndDisagreementFixtures() throws Exception {
        var feature=new SourceAnalysisFeature(1024,"0",32768,24576); var folder=Path.of("../contracts/ai/source-analysis/v1");
        for (var kind:Kind.values()) {
            var name=kind.name().toLowerCase(Locale.ROOT);
            var request=json.readValue(Files.readString(folder.resolve(name+"-model-request.json")),ContextContracts.ContextualRequest.class);
            var result=json.readValue(Files.readString(folder.resolve(name+"-model-result.json")),Result.class);
            var fields=json.readTree(request.request().instruction()); var selected=new ArrayList<UUID>(); var criteria=new ArrayList<String>();
            fields.path("selectedSourceIds").forEach(n -> selected.add(UUID.fromString(n.asString()))); fields.path("criteria").forEach(n -> criteria.add(n.asString()));
            var mapping=new HashMap<String,UUID>(); String[] lines=request.context().text().split("\n");
            for (int i=1;i<lines.length;i+=2) { var block=json.readTree(lines[i]);mapping.put(block.path("chunkId").asString(),UUID.fromString(block.path("sourceId").asString())); }
            result.validateFor(request.request(),kind,selected,criteria,mapping);
            assertEquals(feature.policy(kind).templateHash(),request.request().templateHash());
            assertEquals(feature.policy(kind).parameters(),request.request().parameters());
            var forged=new Result(result.schemaVersion(),UUID.randomUUID(),result.templateId(),result.templateHash(),result.model(),result.usage(),result.providerRequestId(),result.answer());
            assertThrows(IllegalArgumentException.class,() -> forged.validateFor(request.request(),kind,selected,criteria,mapping));
            assertThrows(IllegalArgumentException.class,() -> result.validateFor(request.request(),kind,selected,criteria,Map.of()));
        }
        assertNull(new SourceAnalysisFeature(4096,"none",98304,65536).policy(Kind.COMPARISON).parameters().temperature());
    }
    @Test void publicInputsAndMissingCellsCannotInventData() {
        var a=UUID.randomUUID(); var b=UUID.randomUUID();
        assertEquals(DEFAULT_CRITERIA,new Compare(List.of(a,b),null,null).criteria());
        assertEquals(DEFAULT_CRITERIA,new Compare(List.of(a,b),List.of()," ").criteria());
        assertEquals(List.of("custom"),new Compare(List.of(a,b),List.of(" custom "),"Investigate").criteria());
        assertThrows(IllegalArgumentException.class,() -> new Compare(List.of(a,b),List.of("method","METHOD"),null));
        assertThrows(IllegalArgumentException.class,() -> new Compare(List.of(a),null,null));
        assertThrows(IllegalArgumentException.class,() -> new Compare(List.of(a,a),null,null));
        assertThrows(IllegalArgumentException.class,() -> new Compare(Collections.nCopies(6,a),null,null));
        assertNotNull(new FollowUp(null).instruction());assertNotNull(new FollowUp(" ").instruction());assertEquals("Review",new FollowUp("Review").instruction());
        assertThrows(IllegalArgumentException.class,() -> new Cell("method","MISSING","Invented",List.of()));
        assertThrows(IllegalArgumentException.class,() -> new Cell("method","REPORTED","Fact",List.of()));
        assertThrows(IllegalArgumentException.class,() -> new Statement("Fact",List.of()));
        assertThrows(IllegalArgumentException.class,() -> new Side(a,"Fact",List.of("a".repeat(64),"a".repeat(64))));
        var side=new Side(a,"Fact",List.of("a".repeat(64)));
        assertThrows(IllegalArgumentException.class,() -> new Finding(Category.POTENTIAL_DISAGREEMENT,"Claim",List.of(side,side),new Cell("method","MISSING",null,List.of())));
    }
}
