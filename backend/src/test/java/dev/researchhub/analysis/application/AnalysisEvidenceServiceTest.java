package dev.researchhub.analysis.application;

import dev.researchhub.analysis.application.AnalysisContracts.OutputKind;
import dev.researchhub.analysis.application.ExecutionContracts.*;
import dev.researchhub.analysis.application.ReproductionContracts.*;
import dev.researchhub.shared.error.*;
import org.junit.jupiter.api.*;
import tools.jackson.databind.json.JsonMapper;
import java.time.Instant;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class AnalysisEvidenceServiceTest {
    final AnalysisReproductionService reproduction=mock(AnalysisReproductionService.class);
    final tools.jackson.databind.ObjectMapper json=JsonMapper.builder().findAndAddModules().build();
    final AnalysisEvidenceService service=new AnalysisEvidenceService(reproduction,json);
    final UUID w=UUID.randomUUID(),u=UUID.randomUUID(),a=UUID.randomUUID(),e=UUID.randomUUID(),s=UUID.randomUUID(),v=UUID.randomUUID();
    final AnalysisEvidenceService.Reference ref=new AnalysisEvidenceService.Reference(a,e,"result");
    final DatasetSnapshot input=new DatasetSnapshot(s,v,3,"data.csv","CSV",20,"a".repeat(64),List.of(new SelectedSheet("CSV",List.of(new SelectedColumn(1,"mean")))));
    ComputationProvenance provenance(Status status,List<ComputedOutput> outputs,List<Chart> charts) {
        return new ComputationProvenance("1.0",w,a,e,status,List.of(input),"Compute mean","Computed mean",List.of(),new CodeAccess("PYTHON","c".repeat(64),"/code"),
            outputs==null ? null : new Result("2.0",outputs),charts,outputs==null ? List.of() : outputs.stream().map(o -> new OutputReference(o.name(),o.kind(),"/provenance","/details",null)).toList(),
            Instant.parse("2026-10-05T12:00:00Z"),null,null,"1.1.0","sha256:"+"d".repeat(64),null,"e".repeat(64),new Links("/provenance","/record","/code","/details"));
    }
    ComputedOutput table(List<List<Object>> rows) { return new ComputedOutput(OutputKind.TABLE,"result",List.of("mean"),rows,null,null); }
    void saved(ComputationProvenance p) { when(reproduction.provenance(w,u,a,e)).thenReturn(p); }
    @Test void evidenceContainsOnlySavedNumbersAndExactHistoricalVersions() {
        saved(provenance(Status.SUCCEEDED,List.of(table(List.of(List.of(19.5)))),List.of()));
        var result=service.resolve(w,u,List.of(ref)).getFirst();
        assertEquals(19.5,json.readTree(result.evidence().content()).get("rows").get(0).get(0).asDouble());
        assertEquals(List.of(input),result.citation().inputSources());assertEquals(e,result.citation().executionId());
        assertEquals(dev.researchhub.ai.application.RetrievalIdentity.hash(result.evidence().content()),result.citation().contentHash());
        assertEquals(result,service.resolve(w,u,List.of(ref)).getFirst());
        assertFalse(result.citation().truncated());assertEquals("/details",result.citation().detailsUrl());
        verify(reproduction,times(2)).provenance(w,u,a,e);
    }
    @Test void tableProjectionIsBoundedAndNeverInfersStatisticsForMissingRows() {
        var rows=new ArrayList<List<Object>>();for(int i=0;i<2000;i++) rows.add(List.of("row-"+i+"x".repeat(60)));
        saved(provenance(Status.SUCCEEDED,List.of(table(rows)),List.of()));
        var resolved=service.resolve(w,u,List.of(ref)).getFirst();var data=json.readTree(resolved.evidence().content());
        assertTrue(resolved.citation().truncated());assertTrue(data.get("truncated").asBoolean());
        assertEquals(2000,data.get("totalRows").asInt());assertTrue(data.get("rows").size()<2000);
        assertTrue(resolved.evidence().content().length()<8000);assertFalse(data.has("mean"));
        assertEquals(rows.getFirst().getFirst(),data.get("rows").get(0).get(0).asString());
    }
    @Test void textAndChartEvidenceRemainStructuredAndOversizedTextFailsBeforeGeneration() {
        saved(provenance(Status.SUCCEEDED,List.of(new ComputedOutput(OutputKind.TEXT,"result",null,null,"<script>19.5</script>",null)),List.of()));
        assertEquals("<script>19.5</script>",json.readTree(service.resolve(w,u,List.of(ref)).getFirst().evidence().content()).get("text").asString());
        var chart=new Chart("result","Saved chart",null,null,List.of(),a,e,"c".repeat(64),new Artifact(UUID.randomUUID(),"plot.png","image/png",20,"a".repeat(64)),false);
        saved(provenance(Status.SUCCEEDED,List.of(new ComputedOutput(OutputKind.CHART,"result",null,null,null,chart.image())),List.of(chart)));
        assertEquals(e.toString(),json.readTree(service.resolve(w,u,List.of(ref)).getFirst().evidence().content()).get("chart").get("executionId").asString());
        saved(provenance(Status.SUCCEEDED,List.of(new ComputedOutput(OutputKind.CHART,"result",null,null,null,chart.image())),List.of()));
        assertThrows(ApiException.class,() -> service.resolve(w,u,List.of(ref)));
        saved(provenance(Status.SUCCEEDED,List.of(new ComputedOutput(OutputKind.TEXT,"result",null,null,"x".repeat(8100),null)),List.of()));
        assertEquals(ApiErrorCode.AI_CONTEXT_TOO_LARGE,assertThrows(ApiException.class,() -> service.resolve(w,u,List.of(ref))).code());
    }
    @Test void failedMissingForeignAndDuplicateOutputsCannotBecomeComputedEvidence() {
        for(var status:List.of(Status.FAILED,Status.RUNNING,Status.QUEUED)) {
            saved(provenance(status,null,List.of()));assertThrows(ConflictException.class,() -> service.resolve(w,u,List.of(ref)));
        }
        saved(provenance(Status.SUCCEEDED,null,List.of()));assertThrows(ConflictException.class,() -> service.resolve(w,u,List.of(ref)));
        saved(provenance(Status.SUCCEEDED,List.of(),List.of()));assertThrows(ApiException.class,() -> service.resolve(w,u,List.of(ref)));
        assertThrows(ApiException.class,() -> service.resolve(w,u,Collections.nCopies(7,ref)));
        assertThrows(ApiException.class,() -> service.resolve(w,u,List.of(ref,ref)));
        when(reproduction.provenance(w,u,a,e)).thenThrow(new ResourceNotFoundException("Missing"));
        assertThrows(ResourceNotFoundException.class,() -> service.resolve(w,u,List.of(ref)));
        for(var bad:Arrays.asList(null,""," ","x".repeat(101))) assertThrows(IllegalArgumentException.class,() -> new AnalysisEvidenceService.Reference(a,e,bad));
        assertThrows(IllegalArgumentException.class,() -> new AnalysisEvidenceService.Reference(null,e,"result"));
        assertThrows(IllegalArgumentException.class,() -> new AnalysisEvidenceService.Reference(a,null,"result"));
    }
}
