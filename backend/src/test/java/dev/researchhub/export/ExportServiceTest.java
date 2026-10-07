package dev.researchhub.export;

import dev.researchhub.export.application.*;
import dev.researchhub.export.domain.*;
import dev.researchhub.export.domain.Report.*;
import dev.researchhub.document.application.*;
import dev.researchhub.analysis.application.*;
import dev.researchhub.analysis.application.ExecutionContracts.*;
import dev.researchhub.source.application.*;
import dev.researchhub.shared.error.*;
import dev.researchhub.workspace.application.WorkspaceAuthorizationService;
import org.junit.jupiter.api.Test;
import java.time.*;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static dev.researchhub.export.ReportFixtures.*;

class ExportServiceTest {
    final DocumentService documents=mock(DocumentService.class);
    final DocumentProvenance provenance=mock(DocumentProvenance.class);
    final WorkspaceAuthorizationService auth=mock(WorkspaceAuthorizationService.class);
    final SourceService sources=mock(SourceService.class);
    final ExecutionService executions=mock(ExecutionService.class);
    final ExportStore store=mock(ExportStore.class);
    final ReportRenderer renderer=mock(ReportRenderer.class);
    final Clock clock=Clock.fixed(NOW,ZoneOffset.UTC);
    final ExportService service=new ExportService(documents,provenance,auth,sources,executions,store,renderer,JSON,clock,Duration.ofDays(7));
    final ExportJob job=new ExportJob(UUID.randomUUID(),W,D,U,3,ExportFormat.PDF,ExportJob.Status.QUEUED,"report.pdf",List.of(),NOW,null,null,NOW.plusSeconds(600),null,null,0);
    void document(String content) { when(documents.findOne(W,U,D)).thenReturn(new DocumentDetail(new DocumentSummary(D,"Report","PROSEMIRROR_JSON",3,NOW,NOW,null),content)); }
    @Test void freezesTheSavedRevisionAndTrustedOriginsBeforeQueueingWithoutRendering() {
        UUID block=UUID.randomUUID(),operation=UUID.randomUUID();
        document("{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\",\"attrs\":{\"blockId\":\""+block+"\"}}]}");
        when(provenance.inspect(W,U,D,block)).thenReturn(List.of(new DocumentProvenance.Operation(operation,block,DocumentProvenance.Category.AI_GENERATED,U,"Anna","INSERTED",null,JSON.readTree("{\"model\":\"verified\"}"),3,NOW)));
        when(store.enqueue(any(),any())).thenAnswer(c -> c.getArgument(0));
        var enqueued=service.enqueue(W,U,D,ExportFormat.DOCX,3);
        assertEquals(ExportJob.Status.QUEUED,enqueued.status());assertEquals("Report.docx",enqueued.filename());
        var report=org.mockito.ArgumentCaptor.forClass(Report.class);verify(store).enqueue(any(),report.capture());
        assertEquals(operation,report.getValue().origins().getFirst().operationId());assertTrue(report.getValue().origins().getFirst().metadataJson().contains("verified"));
        verifyNoInteractions(renderer);assertThrows(dev.researchhub.document.domain.StaleRevisionException.class,() -> service.enqueue(W,U,D,ExportFormat.PDF,2));
    }
    @Test void reauthorizesEveryReadAndNeverPublishesRevokedFailedOrOversizedJobs() {
        var claimed=new ExportJob.Claimed(job,rich());
        when(renderer.render(any(),any())).thenReturn(new byte[]{1,2,3});service.execute(claimed);
        verify(store).complete(eq(job.id()),aryEq(new byte[]{1,2,3}),isNull(),eq(NOW));
        when(renderer.render(any(),any())).thenThrow(new IllegalStateException());service.execute(claimed);
        verify(store).complete(job.id(),null,"RENDER_FAILED",NOW);
        doReturn(new byte[32*1024*1024+1]).when(renderer).render(any(),any());service.execute(claimed);
        verify(store).complete(job.id(),null,"OUTPUT_TOO_LARGE",NOW);
        doThrow(new ResourceNotFoundException("Missing")).when(auth).requireContentReader(W,U);service.execute(claimed);
        verify(store).complete(job.id(),null,"ACCESS_REVOKED",NOW);
        assertThrows(ResourceNotFoundException.class,() -> service.find(W,U,D,job.id()));
        assertThrows(ResourceNotFoundException.class,() -> service.report(W,U,D,job.id()));
        assertThrows(ResourceNotFoundException.class,() -> service.download(W,U,D,job.id()));
        reset(auth);when(store.find(W,D,job.id())).thenReturn(job);assertEquals(job,service.find(W,U,D,job.id()));
        service.report(W,U,D,job.id());service.download(W,U,D,job.id());verify(auth,times(3)).requireContentReader(W,U);
    }
    @Test void dispatcherCanBeDisabledAndRecoversInterruptedWorkBeforeClaiming() {
        var dispatcher=new ExportDispatcher(store,service,clock,false);
        dispatcher.scheduledDispatch();verifyNoInteractions(store);
        when(store.claim(NOW)).thenReturn(Optional.empty());dispatcher.dispatchAvailable();
        verify(store).maintain(NOW.minusSeconds(600),NOW);verify(store).claim(NOW);
        var mocked=mock(ExportService.class);when(store.claim(NOW)).thenReturn(Optional.of(new ExportJob.Claimed(job,rich())));
        new ExportDispatcher(store,mocked,clock,true).scheduledDispatch();verify(mocked).execute(any());
        assertThrows(IllegalArgumentException.class,() -> new ExportService(documents,provenance,auth,sources,executions,store,renderer,JSON,clock,Duration.ZERO));
    }
    @Test void analysisReferencesUseExactOutputsAndPreserveFrozenSourceVersionsAndCodeHashes() {
        UUID analysis=UUID.randomUUID(),execution=UUID.randomUUID();
        var refs=new WorkspaceExportReferences(W,U,sources,executions);
        var input=new DatasetSnapshot(S,V,2,"measurements.csv","CSV",20,"a".repeat(64),List.of(new SelectedSheet("data",List.of(new SelectedColumn(0,"x")))));
        for(var kind:AnalysisContracts.OutputKind.values()) {
            var artifact=new Artifact(UUID.randomUUID(),"chart.png","image/png",png().length,ExecutionOutputValidator.sha256(png()));
            var output=new ComputedOutput(kind,"output",List.of("x"),List.of(List.of(4)),"Summary",artifact);
            var run=new Execution(execution,analysis,W,U,1,Status.SUCCEEDED,NOW,NOW,NOW,
                new Provenance(UUID.randomUUID(),"b".repeat(64),"c".repeat(64),List.of(),null,null),new Result("2.0",List.of(output)),null,null);
            when(executions.record(W,U,analysis,execution)).thenReturn(new ExecutionRecord("1.0",new Snapshot("Measurements",null,List.of(input)),run,List.of()));
            when(executions.artifact(W,U,analysis,execution,artifact.id())).thenReturn(new ArtifactContent(artifact,png()));
            String mode=kind==AnalysisContracts.OutputKind.TEXT ? "SUMMARY" : kind.name();
            var blocks=refs.analysis(analysis,execution,"output",mode,"Caption");
            assertFalse(blocks.isEmpty());
            if(blocks.getFirst() instanceof Image image) assertEquals(V,image.provenance().inputs().getFirst().sourceVersionId());
            assertThrows(ApiException.class,() -> refs.analysis(analysis,execution,"missing",mode,""));
            assertThrows(ApiException.class,() -> refs.analysis(analysis,execution,"output","wrong",""));
        }
        var failed=new Execution(execution,analysis,W,U,1,Status.FAILED,NOW,NOW,NOW,null,null,null,null);
        when(executions.record(W,U,analysis,execution)).thenReturn(new ExecutionRecord("1.0",null,failed,List.of()));
        assertThrows(ConflictException.class,() -> refs.analysis(analysis,execution,"output","CHART",""));
        when(sources.findOne(W,U,S)).thenReturn(new SourceSummary(S,W,"original.txt","Authoritative title","text/plain","TXT",20,"a".repeat(64),"READY",null,U,NOW,NOW,V,2));
        var version=new SourceVersionSummary(V,S,W,2,"original.txt","text/plain","TXT",20,"a".repeat(64),"READY",null,U,NOW,NOW,false);
        when(sources.findVersion(W,U,S,V)).thenReturn(version);when(sources.activeVersion(W,U,S)).thenReturn(version);
        assertEquals("Authoritative title",refs.source(S,V,"parser",null,null,null,null,null,List.of()).title());
        assertEquals(V,refs.source(S,null,"parser",null,null,null,null,null,List.of()).sourceVersionId());
    }
    private static byte[] aryEq(byte[] bytes) { return org.mockito.AdditionalMatchers.aryEq(bytes); }
}
