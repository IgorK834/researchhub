package dev.researchhub.analysis.application;

import dev.researchhub.analysis.application.AnalysisContracts.*;
import dev.researchhub.analysis.application.ExecutionContracts.*;
import dev.researchhub.analysis.application.ReproductionContracts.*;
import dev.researchhub.analysis.domain.AnalysisStatus;
import dev.researchhub.shared.error.*;
import dev.researchhub.source.application.*;
import dev.researchhub.workspace.application.WorkspaceAuthorizationService;
import org.junit.jupiter.api.*;
import tools.jackson.databind.json.JsonMapper;
import java.time.Instant;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class AnalysisReproductionServiceTest {
    final WorkspaceAuthorizationService auth=mock(WorkspaceAuthorizationService.class);
    final AnalysisService analyses=mock(AnalysisService.class);final ExecutionService executions=mock(ExecutionService.class);
    final SourceService sources=mock(SourceService.class);final DatasetPreviewService previews=mock(DatasetPreviewService.class);
    final UUID w=UUID.randomUUID(),u=UUID.randomUUID(),a=UUID.randomUUID(),e=UUID.randomUUID(),s=UUID.randomUUID(),v=UUID.randomUUID();
    final Instant now=Instant.parse("2026-10-05T12:00:00Z");
    final AnalysisReproductionService service=new AnalysisReproductionService(auth,analyses,executions,sources,previews,JsonMapper.builder().findAndAddModules().build());
    Plan plan;ExecutionRecord record;Analysis derived;
    @BeforeEach void prepare() {
        plan=new Plan("1.0","Compute",List.of(new PlanInput(v,"CSV",List.of(1))),List.of(),List.of(),
            List.of(new Output(OutputKind.TABLE,"data","Computed data",List.of(v))),List.of(),List.of(),new Code("PYTHON","pass"));
        var run=new Execution(e,a,w,u,1,Status.SUCCEEDED,now,now,now,new Provenance(UUID.randomUUID(),"a".repeat(64),"b".repeat(64),
            List.of(new InputProvenance(s,v,"CSV",4,"a".repeat(64))),null,null),null,null,null);
        record=new ExecutionRecord("1.0",new Snapshot("Compute",plan,List.of(new DatasetSnapshot(s,v,1,"data.csv","CSV",4,"a".repeat(64),
            List.of(new SelectedSheet("CSV",List.of(new SelectedColumn(1,"value"))))))),run,List.of());
        when(executions.record(w,u,a,e)).thenReturn(record);
        when(analyses.find(w,u,a)).thenReturn(new Analysis(a,w,u,"Compute",AnalysisStatus.SUCCEEDED,now,now,List.of(new Input(s,v,"CSV",List.of(1))),run.provenance().planId(),plan,null));
        derived=new Analysis(UUID.randomUUID(),w,u,"Compute",AnalysisStatus.DRAFT,now,now,List.of(new Input(s,v,"CSV",List.of(1))),null,null,null);
        when(analyses.createDerived(eq(w),eq(u),any(),any())).thenReturn(derived);
        when(sources.findOne(w,u,s)).thenReturn(source("CSV","READY"));
        when(previews.preview(w,s,v,u)).thenReturn(preview("CSV","value"));
    }
    SourceSummary source(String format,String status) { return new SourceSummary(s,w,"data.csv","data.csv","text/csv",format,4,"a".repeat(64),status,null,u,now,now,v,1); }
    DatasetPreview preview(String sheet,String label) {
        return new DatasetPreview("1.0",s,v,1,"data.csv",4,"a".repeat(64),"CSV",false,false,null,List.of(),List.of(
            new DatasetPreview.Sheet(sheet,"visible",1,false,null,List.of(new DatasetPreview.Column(1,label,"NUMBER",0,1,true)),List.of(),false)));
    }
    @Test void originalWithoutRecordedRuntimeKeepsCodeAndNeverConsultsLatestData() {
        var result=service.rerun(w,u,a,e,new Rerun(InputMode.ORIGINAL));
        assertFalse(result.lineage().inputsChanged());assertNull(result.lineage().requestedRuntime());
        verify(executions).enqueue(w,u,a,result.lineage());verifyNoInteractions(sources,previews);
        assertThrows(IllegalArgumentException.class,() -> new Rerun(null));
    }
    @Test void latestRejectsFormatReadinessSheetsColumnsAndUnknownHistoricalLabelsBeforeCreatingIntent() {
        for (var invalid:List.of(source("PDF","READY"),source("CSV","PROCESSING"))) {
            when(sources.findOne(w,u,s)).thenReturn(invalid);assertThrows(ConflictException.class,() -> service.rerun(w,u,a,e,new Rerun(InputMode.LATEST)));
        }
        when(sources.findOne(w,u,s)).thenReturn(source("CSV","READY"));
        for (var invalid:List.of(preview("OTHER","value"),preview("CSV","changed"))) {
            when(previews.preview(w,s,v,u)).thenReturn(invalid);assertThrows(ConflictException.class,() -> service.rerun(w,u,a,e,new Rerun(InputMode.LATEST)));
        }
        var input=record.snapshot().inputs().getFirst();
        var unknown=new DatasetSnapshot(s,v,1,input.originalFilename(),"CSV",4,input.sha256(),List.of(new SelectedSheet("CSV",List.of(new SelectedColumn(1,null)))));
        when(executions.record(w,u,a,e)).thenReturn(new ExecutionRecord("1.0",new Snapshot("Compute",plan,List.of(unknown)),record.execution(),List.of()));
        when(previews.preview(w,s,v,u)).thenReturn(preview("CSV","value"));
        assertThrows(ConflictException.class,() -> service.rerun(w,u,a,e,new Rerun(InputMode.LATEST)));
        verify(analyses,never()).createDerived(any(),any(),any(),any());verify(executions,never()).enqueue(any(),any(),any(),any());
    }
    @Test void unexpectedPlanningFailureStillReturnsOnlySafeFailureAndDerivedIdentityAndRechecksAccess() {
        when(analyses.plan(w,u,derived.id())).thenThrow(new IllegalStateException("sensitive provider traceback"));
        var result=service.rerun(w,u,a,e,new Rerun(InputMode.LATEST));
        assertEquals(derived.id(),result.analysisId());assertEquals("INTERNAL_ERROR",result.failureCode());assertNull(result.execution());
        assertFalse(result.toString().contains("sensitive"));verify(auth).requireContentReader(w,u);
        doThrow(new ResourceNotFoundException("Access revoked")).when(auth).requireContentReader(w,u);
        assertThrows(ResourceNotFoundException.class,() -> service.rerun(w,u,a,e,new Rerun(InputMode.LATEST)));
    }
    @Test void emptyAndPendingResultsHaveNoInventedTimestampOrNumericReferences() {
        var pending=new Execution(e,a,w,u,1,Status.QUEUED,now,null,null,record.execution().provenance(),null,null,null);
        when(executions.record(w,u,a,e)).thenReturn(new ExecutionRecord("1.0",record.snapshot(),pending,List.of()));
        var provenance=service.provenance(w,u,a,e);assertNull(provenance.executionTimestamp());assertNull(provenance.result());assertTrue(provenance.outputReferences().isEmpty());
        assertThrows(ConflictException.class,() -> service.rerun(w,u,a,e,new Rerun(InputMode.ORIGINAL)));
    }
}
