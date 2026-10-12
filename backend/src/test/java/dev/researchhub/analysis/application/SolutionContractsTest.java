package dev.researchhub.analysis.application;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import dev.researchhub.analysis.application.ProblemContracts.*;
import dev.researchhub.shared.error.*;
import org.junit.jupiter.api.*;
import tools.jackson.databind.*;
import tools.jackson.databind.node.ObjectNode;
import java.nio.file.*;
import java.util.*;

class SolutionContractsTest {
    ProblemServiceTest rig; Execution e;
    @BeforeEach void prepare() throws Exception {rig=new ProblemServiceTest();rig.setup();rig.ready(false);e=rig.execute();}
    @Test void immutableSavedBundleHasDeterministicStepsAndReadsWithoutCompute() throws Exception {
        var bundle=e.solution();assertEquals("SOLUTION",bundle.kind());assertEquals("NOT_CHECKED",bundle.interpretation().status());
        assertEquals(bundle,SolutionContracts.assemble(rig.json,rig.state,e.id(),e.result(),e.verification(),bundle.codeHashes()));
        assertEquals(ProblemJson.canonical(rig.json,bundle),ProblemJson.canonical(rig.json,rig.json.readValue(rig.json.writeValueAsString(bundle),SolutionContracts.Bundle.class)));
        var fixture=rig.json.readValue(Files.readString(Path.of("../contracts/analysis/execution/v3/solution.json")),SolutionContracts.Bundle.class);
        assertEquals("CHECKED",fixture.steps().getFirst().check());assertEquals(.5,fixture.steps().getFirst().values().get(0).asDouble());
        when(rig.store.execution(rig.w,rig.state.id(),e.id())).thenReturn(Optional.of(e));
        var service=new SolutionService(rig.store,rig.access);assertEquals(bundle,service.find(rig.w,rig.caller,rig.state.id(),e.id()));
        verify(rig.access,atLeastOnce()).requireContentReader(rig.w,rig.caller);verify(rig.runner,times(2)).run(any());
        assertThrows(ResourceNotFoundException.class,()->service.find(rig.w,rig.caller,rig.state.id(),UUID.randomUUID()));
        var old=new Execution(e.id(),e.analysisId(),e.status(),e.failureCode(),e.createdAt(),e.completedAt(),e.imageId(),e.runtimeVersion(),e.inputHash(),e.planHash(),e.result(),e.verification());
        for(var broken:List.of(
            new Execution(e.id(),e.analysisId(),"FAILED",e.failureCode(),e.createdAt(),e.completedAt(),e.imageId(),e.runtimeVersion(),e.inputHash(),e.planHash(),e.result(),e.verification(),e.computationStatus(),bundle),
            new Execution(e.id(),e.analysisId(),e.status(),e.failureCode(),e.createdAt(),e.completedAt(),e.imageId(),e.runtimeVersion(),e.inputHash(),e.planHash(),e.result(),null,e.computationStatus(),bundle),
            new Execution(e.id(),e.analysisId(),e.status(),e.failureCode(),e.createdAt(),e.completedAt(),e.imageId(),e.runtimeVersion(),e.inputHash(),e.planHash(),e.result(),new Verification("REJECTED",null,null,null,null,null,null),e.computationStatus(),bundle))) {
            when(rig.store.execution(rig.w,rig.state.id(),e.id())).thenReturn(Optional.of(broken));assertThrows(ConflictException.class,()->service.find(rig.w,rig.caller,rig.state.id(),e.id()));
        }
        when(rig.store.execution(rig.w,rig.state.id(),e.id())).thenReturn(Optional.of(old));
        assertThrows(ConflictException.class,()->service.find(rig.w,rig.caller,rig.state.id(),e.id()));
    }
    void reject(java.util.function.Consumer<ObjectNode> edit) {
        var candidate=(ObjectNode)e.result().deepCopy();edit.accept(candidate);
        var v=e.verification();var forged=new Verification(v.status(),v.inputHash(),v.planHash(),ProblemJson.hash(rig.json,candidate),v.imageId(),v.runtimeVersion(),v.receipt());
        assertThrows(RuntimeException.class,()->SolutionContracts.assemble(rig.json,rig.state,e.id(),candidate,forged,e.solution().codeHashes()));
    }
    @Test void substitutionsUnitsExpressionsAndBoundedStepsCannotBecomeCheckedThroughProse() {
        reject(n->((ObjectNode)n.at("/outputs/0/steps/0/substitution/distance")).put("value","200"));
        reject(n->((ObjectNode)n.at("/outputs/0/steps/0/substitution/distance")).put("unit","m"));
        reject(n->((ObjectNode)n.at("/outputs/0/steps/0/substitution")).put("invented",12));
        reject(n->((ObjectNode)n.at("/outputs/0/steps/0/substitution/distance")).put("siValue","1".repeat(257)));
        reject(n->((ObjectNode)n.at("/outputs/0/steps/0")).put("unit","cm/s"));
        reject(n->((ObjectNode)n.at("/outputs/0/steps/0")).put("operation","LLM_APPROVED"));
        reject(n->((ObjectNode)n.at("/outputs/0/steps/0/expression")).put("op","mul"));
        reject(n->((ObjectNode)n.at("/outputs/0/steps/0")).putArray("values").add(999));
        reject(n->((ObjectNode)n.at("/outputs/0")).putArray("steps"));
        reject(n->n.putArray("outputs"));
        reject(n->{var output=n.path("outputs").get(0).deepCopy();var outputs=n.putArray("outputs");for(int i=0;i<33;i++)outputs.add(output);});
        reject(n->{var steps=(tools.jackson.databind.node.ArrayNode)n.at("/outputs/0/steps");var first=steps.get(0).deepCopy();for(int i=0;i<4;i++)steps.add(first);});
    }
    @Test void imageCodeAndReceiptInputIdentityCannotBeReplaced() {
        var v=e.verification();assertThrows(RuntimeException.class,()->SolutionContracts.assemble(rig.json,rig.state,e.id(),e.result(),null,e.solution().codeHashes()));
        for(var bad:List.of(new Verification("NOT_CHECKED",v.inputHash(),v.planHash(),v.candidateHash(),v.imageId(),v.runtimeVersion(),v.receipt()),new Verification("CHECKED","f".repeat(64),v.planHash(),v.candidateHash(),v.imageId(),v.runtimeVersion(),v.receipt()),new Verification("CHECKED",v.inputHash(),"f".repeat(64),v.candidateHash(),v.imageId(),v.runtimeVersion(),v.receipt()),new Verification("CHECKED",v.inputHash(),v.planHash(),"f".repeat(64),v.imageId(),v.runtimeVersion(),v.receipt())))
            assertThrows(RuntimeException.class,()->SolutionContracts.assemble(rig.json,rig.state,e.id(),e.result(),bad,e.solution().codeHashes()));
        for(var hashes:List.of(Map.<String,String>of(),Map.of("problem.py","not-a-hash","verify_problem.py","b".repeat(64))))
            assertThrows(RuntimeException.class,()->SolutionContracts.assemble(rig.json,rig.state,e.id(),e.result(),v,hashes));
    }
}
