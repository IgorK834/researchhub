package dev.researchhub.analysis.application;

import dev.researchhub.analysis.application.AnalysisContracts.*;
import dev.researchhub.analysis.application.ExecutionContracts.*;
import dev.researchhub.analysis.domain.AnalysisStatus;
import dev.researchhub.shared.error.*;
import dev.researchhub.source.application.*;
import dev.researchhub.workspace.application.WorkspaceAuthorizationService;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.time.*;
import java.util.*;
import org.junit.jupiter.api.*;
import org.mockito.ArgumentCaptor;
import tools.jackson.databind.json.JsonMapper;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class ExecutionServiceTest {
    final JsonMapper json=JsonMapper.builder().findAndAddModules().build();
    final WorkspaceAuthorizationService auth=mock(WorkspaceAuthorizationService.class);
    final AnalysisService analyses=mock(AnalysisService.class);
    final SourceService sources=mock(SourceService.class);
    final ExecutionStore store=mock(ExecutionStore.class);
    final SandboxRunner runner=mock(SandboxRunner.class);
    final UUID workspace=UUID.randomUUID(),caller=UUID.randomUUID(),id=UUID.randomUUID(),source=UUID.randomUUID(),version=UUID.randomUUID(),planId=UUID.randomUUID();
    final Clock clock=Clock.fixed(Instant.parse("2026-10-03T12:00:00Z"),ZoneOffset.UTC);
    final byte[] bytes="frequency,voltage,current\n100,2,1\n".getBytes(StandardCharsets.UTF_8);
    final String hash=ExecutionOutputValidator.sha256(bytes);
    ExecutionService service;
    Analysis ready;
    @BeforeEach void prepare() {
        var plan=new Plan("1.0","Compute U/I",List.of(new PlanInput(version,"CSV",List.of(1,2,3))),List.of(),List.of(),
            List.of(new Output(OutputKind.TABLE,"computed","Computed rows",List.of(version))),List.of(),List.of(),new Code("PYTHON","untrusted code as data"));
        ready=new Analysis(id,workspace,caller,"Compute impedance",AnalysisStatus.READY_TO_EXECUTE,clock.instant(),clock.instant(),
            List.of(new Input(source,version,"CSV",List.of(1,2,3))),planId,plan,null);
        when(analyses.find(workspace,caller,id)).thenReturn(ready);
        var preview=new DatasetPreview("1.0",source,version,1,"data.csv",bytes.length,hash,"CSV",false,false,null,List.of(),
            List.of(new DatasetPreview.Sheet("CSV","visible",1,false,null,List.of(
                new DatasetPreview.Column(1,"frequency","NUMBER",0,1,true),new DatasetPreview.Column(2,"voltage","NUMBER",0,1,true),
                new DatasetPreview.Column(3,"current","NUMBER",0,1,true)),List.of(),false)));
        when(analyses.attempts(workspace,caller,id)).thenReturn(List.of(new PlanAudit(planId,1,caller,
            new PlanningRequest("1.0",id,null,List.of(new InspectedInput(ready.inputs().getFirst(),preview)),List.of()),null,plan,null,clock.instant())));
        when(sources.findVersion(workspace,caller,source,version)).thenReturn(summary("CSV","READY",bytes.length,hash));
        when(sources.openVersionContent(workspace,caller,source,version)).thenAnswer(_i ->
            new SourceVersionContent(summary("CSV","READY",bytes.length,hash),new ByteArrayInputStream(bytes)));
        when(store.enqueue(eq(workspace),eq(id),eq(caller),any(),any(),any())).thenAnswer(i ->
            new Execution(UUID.randomUUID(),id,workspace,caller,1,Status.QUEUED,clock.instant(),null,null,i.getArgument(3),null,null,null));
        when(runner.run(any())).thenReturn(run(true,null,"",validFiles()));
        service=new ExecutionService(auth,analyses,sources,store,runner,json,clock);
    }
    SourceVersionSummary summary(String type,String status,long size,String sha) {
        return new SourceVersionSummary(version,source,workspace,1,"data.csv","text/csv",type,size,sha,status,null,caller,clock.instant(),clock.instant(),true);
    }
    Map<String,byte[]> validFiles() { return Map.of("result.json","{\"schemaVersion\":\"1.0\",\"outputs\":[{\"name\":\"computed\",\"kind\":\"TABLE\",\"columns\":[\"impedance\"],\"rows\":[[2.0]]}]}".getBytes(StandardCharsets.UTF_8)); }
    SandboxRunner.Result run(boolean success,String failure,String stdout,Map<String,byte[]> files) {
        return new SandboxRunner.Result(success,failure,success ? 0 : 7,false,stdout,"runtime diagnostic",false,false,
            "sha256:"+"a".repeat(64),"1.0.0",files);
    }
    Execution claimed() {
        var queued=service.enqueue(workspace,caller,id);
        return new Execution(queued.id(),id,workspace,caller,queued.attempt(),Status.RUNNING,queued.createdAt(),clock.instant(),null,queued.provenance(),null,null,null);
    }
    void failed(Execution execution,Failure failure) {
        verify(store).complete(eq(execution),any(),isNull(),eq(failure),any(),eq(clock.instant()));
    }
    @Test void queueingAndEveryHistoryReadUseTheWorkspaceAndFixedAcceptedPlan() {
        var queued=service.enqueue(workspace,caller,id);
        assertEquals(planId,queued.provenance().planId());assertEquals(hash,queued.provenance().inputs().getFirst().sha256());
        assertEquals(ExecutionOutputValidator.sha256(ready.plan().code().source()),queued.provenance().codeSha256());
        verify(auth).requireContentEditor(workspace,caller);verifyNoInteractions(runner);
        var snapshot=ArgumentCaptor.forClass(Snapshot.class);verify(store).enqueue(eq(workspace),eq(id),eq(caller),any(),snapshot.capture(),any());
        assertEquals(ready.userPrompt(),snapshot.getValue().userPrompt());assertEquals(ready.plan(),snapshot.getValue().plan());
        assertEquals("frequency",snapshot.getValue().inputs().getFirst().sheets().getFirst().columns().getFirst().label());
        when(store.list(workspace,id)).thenReturn(List.of(queued));assertEquals(List.of(queued),service.list(workspace,caller,id));
        when(store.find(workspace,id,queued.id())).thenReturn(queued);assertSame(queued,service.find(workspace,caller,id,queued.id()));
        var artifactId=UUID.randomUUID();var content=new ArtifactContent(new Artifact(artifactId,"figure.png","image/png",1,hash),new byte[]{1});
        when(store.artifact(workspace,id,queued.id(),artifactId)).thenReturn(content);
        assertSame(content,service.artifact(workspace,caller,id,queued.id(),artifactId));verify(analyses,times(4)).find(workspace,caller,id);
        var record=new ExecutionRecord("1.0",snapshot.getValue(),queued,List.of());when(store.record(workspace,id,queued.id())).thenReturn(record);
        assertSame(record,service.record(workspace,caller,id,queued.id()));verify(analyses,times(5)).find(workspace,caller,id);
    }
    @Test void unplannedViewerAndOversizedOrUnreadyInputsNeverReachTheRunner() {
        doThrow(new ForbiddenException("Viewer")).when(auth).requireContentEditor(workspace,caller);
        assertThrows(ForbiddenException.class,() -> service.enqueue(workspace,caller,id));reset(auth);
        var draft=new Analysis(id,workspace,caller,"draft",AnalysisStatus.DRAFT,clock.instant(),clock.instant(),ready.inputs(),null,null,null);
        when(analyses.find(workspace,caller,id)).thenReturn(draft);assertThrows(ConflictException.class,() -> service.enqueue(workspace,caller,id));
        when(analyses.find(workspace,caller,id)).thenReturn(ready);
        when(sources.findVersion(any(),any(),any(),any())).thenReturn(summary("CSV","READY",ExecutionService.MAX_INPUT_BYTES+1L,hash));
        assertThrows(PayloadTooLargeException.class,() -> service.enqueue(workspace,caller,id));
        for (var metadata:List.of(summary("PDF","READY",bytes.length,hash),summary("XLSX","PROCESSING",bytes.length,hash))) {
            when(sources.findVersion(any(),any(),any(),any())).thenReturn(metadata);
            assertThrows(ConflictException.class,() -> service.enqueue(workspace,caller,id));
        }
        verifyNoInteractions(store,runner);
    }
    @Test void exactInputBytesAndRuntimeResultsAreValidatedThenPublishedWithProvenanceAndDiagnostics() {
        var execution=claimed();service.execute(execution);
        var launch=ArgumentCaptor.forClass(SandboxRunner.Request.class);verify(runner).run(launch.capture());
        assertEquals(execution.id(),launch.getValue().executionId());assertEquals(planId,launch.getValue().planId());
        assertEquals(ready.plan().code().source(),launch.getValue().code());assertArrayEquals(bytes,launch.getValue().inputs().getFirst().bytes());
        var result=ArgumentCaptor.forClass(Validated.class);var provenance=ArgumentCaptor.forClass(Provenance.class);var diagnostics=ArgumentCaptor.forClass(Diagnostics.class);
        verify(store).complete(eq(execution),provenance.capture(),result.capture(),isNull(),diagnostics.capture(),eq(clock.instant()));
        assertEquals(2.0,result.getValue().result().outputs().getFirst().rows().getFirst().getFirst());
        assertEquals(execution.provenance().codeSha256(),provenance.getValue().codeSha256());assertEquals("1.0.0",provenance.getValue().runtimeVersion());
        assertEquals("sha256:"+"a".repeat(64),provenance.getValue().imageId());assertEquals(SandboxRunner.IMAGE,diagnostics.getValue().configuredImage());
        assertEquals(0,diagnostics.getValue().exitCode());verify(auth,atLeast(4)).requireContentEditor(workspace,caller);
    }
    @Test void alteredMetadataOrBytesAndStorageFailuresStopBeforeExecution() {
        var execution=claimed();
        when(sources.findVersion(any(),any(),any(),any())).thenReturn(summary("CSV","READY",bytes.length,"b".repeat(64)));
        service.execute(execution);failed(execution,Failure.INPUT_CHANGED);reset(store);
        when(sources.findVersion(any(),any(),any(),any())).thenReturn(summary("CSV","READY",bytes.length,hash));
        when(sources.openVersionContent(any(),any(),any(),any())).thenReturn(new SourceVersionContent(summary("CSV","READY",bytes.length,hash),new ByteArrayInputStream(new byte[]{1})));
        service.execute(execution);failed(execution,Failure.INPUT_CHANGED);reset(store);
        when(sources.openVersionContent(any(),any(),any(),any())).thenThrow(new UncheckedIOException(new IOException("storage secret")));
        service.execute(execution);failed(execution,Failure.INPUT_UNAVAILABLE);reset(store);
        doReturn(new SourceVersionContent(summary("CSV","READY",bytes.length,hash),new InputStream() {
            @Override public int read() throws IOException { throw new IOException("private storage error"); }
        })).when(sources).openVersionContent(any(),any(),any(),any());
        service.execute(execution);failed(execution,Failure.INPUT_UNAVAILABLE);verifyNoInteractions(runner);
    }
    @Test void revokedQueuedAndCompletedExecutionsCannotPublishResults() {
        var execution=claimed();doThrow(new ResourceNotFoundException("Revoked")).when(auth).requireContentEditor(workspace,caller);
        service.execute(execution);failed(execution,Failure.ACCESS_REVOKED);verifyNoInteractions(runner);reset(store,auth);
        doNothing().doNothing().doThrow(new ForbiddenException("Revoked")).when(auth).requireContentEditor(workspace,caller);
        service.execute(execution);failed(execution,Failure.ACCESS_REVOKED);verify(runner).run(any());
    }
    @Test void runnerAndMalformedOutputFailuresAreStructuredAndLogRetentionIsBounded() {
        var execution=claimed();
        when(runner.run(any())).thenReturn(run(false,"EXECUTION_TIMEOUT","x".repeat(70000),Map.of()));
        service.execute(execution);failed(execution,Failure.EXECUTION_TIMEOUT);
        var captured=ArgumentCaptor.forClass(Diagnostics.class);verify(store).complete(any(),any(),any(),any(),captured.capture(),any());
        assertEquals(ExecutionLogSanitizer.MAX_CHARACTERS,captured.getValue().stdout().length());assertTrue(captured.getValue().stdoutTruncated());reset(store);
        when(runner.run(any())).thenReturn(run(false,"private provider details",null,Map.of()));
        service.execute(execution);failed(execution,Failure.EXECUTION_FAILED);reset(store);
        when(runner.run(any())).thenReturn(run(true,null,"",Map.of("result.json","{}".getBytes())));
        service.execute(execution);failed(execution,Failure.EXECUTION_OUTPUT_INVALID);reset(store);
        when(runner.run(any())).thenThrow(new IllegalStateException("host credential"));
        service.execute(execution);failed(execution,Failure.INTERNAL_ERROR);
    }
    @Test void dispatcherOnlySchedulesWhenEnabledAndRecoversWithoutHiddenRetries() {
        var execution=claimed();when(store.claim(clock.instant())).thenReturn(Optional.of(execution));
        var dispatcher=new AnalysisExecutionDispatcher(store,service,clock,false);dispatcher.scheduledDispatch();verify(store,never()).claim(any());
        dispatcher.dispatchAvailable();verify(store).recoverInterrupted(clock.instant().minusSeconds(600),clock.instant());
        verify(runner).run(any());reset(store);when(store.claim(any())).thenReturn(Optional.empty());
        new AnalysisExecutionDispatcher(store,service,clock,true).scheduledDispatch();verify(store).claim(clock.instant());
    }
}
