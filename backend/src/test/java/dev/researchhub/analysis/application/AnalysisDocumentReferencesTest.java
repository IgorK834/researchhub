package dev.researchhub.analysis.application;
import dev.researchhub.analysis.application.AnalysisContracts.OutputKind;
import dev.researchhub.analysis.application.ExecutionContracts.*;
import dev.researchhub.shared.error.*;
import org.junit.jupiter.api.*;
import tools.jackson.databind.json.JsonMapper;
import java.time.Instant;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class AnalysisDocumentReferencesTest {
    final ExecutionService executions=mock(ExecutionService.class);
    final tools.jackson.databind.ObjectMapper json=JsonMapper.builder().findAndAddModules().build();
    final AnalysisDocumentReferences validator=new AnalysisDocumentReferences(executions,json);
    final UUID w=UUID.randomUUID(),u=UUID.randomUUID(),a=UUID.randomUUID(),e=UUID.randomUUID(),block=UUID.randomUUID();
    String node(String mode) { return json.writeValueAsString(Map.of("type","analysisResult","attrs",Map.of("blockId",block,"reference",Map.of("analysisId",a,"executionId",e,"outputId","saved","renderMode",mode),"caption","<script>inert caption</script>"))); }
    ExecutionRecord saved(Status status,OutputKind kind,boolean result) {
        return new ExecutionRecord("1.0",null,new Execution(e,a,w,u,1,status,Instant.now(),null,null,null,
            result ? new Result("2.0",List.of(new ComputedOutput(kind,"saved",null,null,null,null))) : null,null,null),List.of());
    }
    @Test void validatesAllRenderModesAgainstTheExactSuccessfulExecution() {
        for(var kind:OutputKind.values()) {
            when(executions.record(w,u,a,e)).thenReturn(saved(Status.SUCCEEDED,kind,true));
            validator.validate(w,u,"{\"type\":\"doc\",\"content\":["+node(kind==OutputKind.TEXT?"SUMMARY":kind.name())+"]}");
        }
        verify(executions,times(3)).record(w,u,a,e);
        validator.validate(w,u,"{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\"}]}");
    }
    @Test void failuresScopeAndMissingOutputsFailClosed() {
        when(executions.record(w,u,a,e)).thenThrow(new ResourceNotFoundException("Missing"));
        assertThrows(ResourceNotFoundException.class,() -> validator.validate(w,u,node("TABLE")));
        for(var status:List.of(Status.FAILED,Status.RUNNING,Status.QUEUED,Status.SUCCEEDED)) {
            doReturn(saved(status,OutputKind.TABLE,false)).when(executions).record(w,u,a,e);
            assertThrows(ConflictException.class,() -> validator.validate(w,u,node("TABLE")));
        }
        when(executions.record(w,u,a,e)).thenReturn(saved(Status.SUCCEEDED,OutputKind.TABLE,true));
        assertThrows(ApiException.class,() -> validator.validate(w,u,node("CHART")));
        assertThrows(ApiException.class,() -> validator.validate(w,u,node("TABLE").replace("saved","missing")));
    }
    @Test void malformedInjectedAndDuplicateReferencesAreRejectedRatherThanNormalizedAway() {
        when(executions.record(w,u,a,e)).thenReturn(saved(Status.SUCCEEDED,OutputKind.TABLE,true));
        var valid=json.readTree(node("TABLE"));
        var mutations=List.of(
            node("TABLE").replace(block.toString(),"not-uuid"),
            node("TABLE").replace("\"caption\":","\"imageUrl\":\"https://evil.test\",\"caption\":"),
            node("TABLE").replace("\"renderMode\":","\"code\":\"evil()\",\"renderMode\":"),
            node("TABLE").replace("\"TABLE\"","null"),
            node("TABLE").replace("\"saved\"","42"),
            node("TABLE").replace("\"<script>inert caption</script>\"","42"),
            node("TABLE").replace("<script>inert caption</script>","x".repeat(1001)),
            "{\"type\":\"analysisResult\",\"attrs\":null}",
            "{\"type\":\"analysisResult\",\"attrs\":{}}",
            node("TABLE").replace("\"type\":","\"text\":\"injected\",\"type\":"));
        for(var bad:mutations) assertThrows(ApiException.class,() -> validator.validate(w,u,bad),bad);
        assertThrows(ApiException.class,() -> validator.validate(w,u,"{\"type\":\"doc\",\"content\":["+valid+","+valid+"]}"));
        assertThrows(ApiException.class,() -> validator.validate(w,u,"{\"type\":\"doc\",\"content\":["+String.join(",",Collections.nCopies(51,node("TABLE")))+"]}"));
        String deep=node("TABLE");for(int i=0;i<70;i++) deep="{\"content\":["+deep+"]}";
        String tooDeep=deep;assertThrows(ApiException.class,() -> validator.validate(w,u,tooDeep));
    }
}
