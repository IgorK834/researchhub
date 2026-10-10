package dev.researchhub.ai.application;
import dev.researchhub.ai.application.CanvasContracts.*;
import dev.researchhub.document.application.CanvasTargets.*;
import dev.researchhub.document.application.*;
import dev.researchhub.document.application.CanvasPositionResolver;
import dev.researchhub.analysis.application.AnalysisEvidenceService;
import dev.researchhub.source.application.SourceService;
import dev.researchhub.workspace.application.WorkspaceAuthorizationService;
import dev.researchhub.shared.error.*;
import org.junit.jupiter.api.*;
import tools.jackson.databind.ObjectMapper;
import java.nio.file.*;
import java.time.*;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;
class CanvasContextServiceTest {
    ObjectMapper json=new ObjectMapper();DocumentService documents=mock(DocumentService.class);
    DocumentSnapshotState state=mock(DocumentSnapshotState.class);CanvasPositionResolver resolver=mock(CanvasPositionResolver.class);
    CanvasContextStore store=mock(CanvasContextStore.class);WorkspaceAuthorizationService access=mock(WorkspaceAuthorizationService.class);
    SourceService sources=mock(SourceService.class);SourceRetrievalService retrieval=mock(SourceRetrievalService.class);AnalysisEvidenceService analyses=mock(AnalysisEvidenceService.class);
    UUID workspace=UUID.randomUUID(),document=UUID.randomUUID(),caller=UUID.randomUUID();Capture request;Context context;CanvasContextService service;DocumentDetail detail;
    @BeforeEach void setup() throws Exception {
        var fixture=json.readTree(Files.readString(Path.of("../contracts/ai/canvas/v1/unicode.json")));
        request=json.treeToValue(fixture.path("capture"),Capture.class);
        context=json.readValue(Files.readString(Path.of("../contracts/ai/canvas/v1/context.json")),Context.class);
        var summary=mock(DocumentSummary.class);when(summary.revision()).thenReturn(3L);when(summary.archivedAt()).thenReturn(null);
        detail=new DocumentDetail(summary,json.writeValueAsString(fixture.path("content")));
        when(documents.lockForContext(workspace,caller,document)).thenReturn(detail);when(documents.findOne(workspace,caller,document)).thenReturn(detail);
        when(access.permitsSystemContentMaintenance(workspace)).thenReturn(true);when(state.snapshotState(document)).thenReturn(Optional.empty());
        when(store.replay(any(),any(),any(),any())).thenReturn(Optional.empty());when(store.find(any(),any(),any())).thenReturn(Optional.of(new CanvasContextStore.Stored(CanvasDocumentTarget.hash(json.writeValueAsString(request)),request,context)));
        service=new CanvasContextService(documents,List.of(state),resolver,store,access,sources,retrieval,analyses,json,Clock.fixed(Instant.parse("2026-10-09T18:00:00Z"),ZoneOffset.UTC));
    }
    @Test void captureReplayAndAuthorizedRead() {
        var result=service.capture(workspace,document,caller,request);assertEquals("A😀B",result.snapshot().text());verify(store).insert(eq(caller),anyString(),eq(request),eq(result));
        when(store.replay(any(),any(),any(),any())).thenReturn(Optional.of(new CanvasContextStore.Stored(CanvasDocumentTarget.hash(json.writeValueAsString(request)),request,result)));
        assertEquals(result,service.capture(workspace,document,caller,request));
        assertEquals(context,service.find(workspace,document,caller,context.contextId()));
        assertEquals(context.snapshot(),service.resolve(workspace,document,caller,context.contextId()));
        when(store.replay(any(),any(),any(),any())).thenReturn(Optional.of(new CanvasContextStore.Stored("different",request,result)));
        assertThrows(ApiException.class,()->service.capture(workspace,document,caller,request));
        when(store.find(any(),any(),any())).thenReturn(Optional.empty());assertThrows(ResourceNotFoundException.class,()->service.find(workspace,document,caller,UUID.randomUUID()));
    }
    Capture realtime(long epoch,long sequence) {return new Capture("1.0",UUID.randomUUID(),3,epoch,sequence,"AA==",new Relative("AA==","AA=="),request.target());}
    @Test void realtimeRequiresExactAcknowledgmentAndChecksResolvedBlock() {
        var saved=new DocumentSnapshotState.State(new byte[]{1},"a".repeat(64),2,5);when(state.snapshotState(document)).thenReturn(Optional.of(saved));
        when(resolver.pin(any(),any())).thenReturn(new Resolution(request.target().start(),request.target().end(),new Relative("AA==","AA==")));
        assertEquals(2L,service.capture(workspace,document,caller,request).epoch());
        assertThrows(ApiException.class,()->service.capture(workspace,document,caller,realtime(1,5)));
        assertThrows(ApiException.class,()->service.capture(workspace,document,caller,realtime(2,4)));
        var real=realtime(2,5);when(resolver.resolve(any(),any(),any())).thenReturn(new Resolution(real.target().start(),real.target().end()));
        assertEquals(2L,service.capture(workspace,document,caller,real).epoch());
        when(resolver.resolve(any(),any(),any())).thenReturn(new Resolution(new Endpoint(null,List.of(0),0),real.target().end()));
        assertThrows(ApiException.class,()->service.capture(workspace,document,caller,real));
        when(state.snapshotState(document)).thenReturn(Optional.empty());when(state.requiresRealtime(document)).thenReturn(true);
        assertThrows(ApiException.class,()->service.capture(workspace,document,caller,request));
    }
    @Test void reanchorOnlyWithinSameBlockAndEpoch() {
        var real=realtime(2,5);var ctx=new Context("1.0",context.contextId(),workspace,document,3,2L,5L,context.snapshot(),context.createdAt());
        when(store.find(any(),any(),any())).thenReturn(Optional.of(new CanvasContextStore.Stored("x",real,ctx)));
        assertThrows(ApiException.class,()->service.resolve(workspace,document,caller,ctx.contextId()));
        when(state.snapshotState(document)).thenReturn(Optional.of(new DocumentSnapshotState.State(new byte[]{1},"x",2,7)));
        when(resolver.resolve(any(),any(),isNull())).thenReturn(new Resolution(request.target().start(),request.target().end()));
        assertEquals("A😀B",service.resolve(workspace,document,caller,ctx.contextId()).text());
        when(resolver.resolve(any(),any(),isNull())).thenReturn(new Resolution(new Endpoint("foreign",List.of(0),3),request.target().end()));
        assertThrows(ApiException.class,()->service.resolve(workspace,document,caller,ctx.contextId()));
        when(state.snapshotState(document)).thenReturn(Optional.of(new DocumentSnapshotState.State(new byte[]{1},"x",3,7)));
        assertThrows(ApiException.class,()->service.resolve(workspace,document,caller,ctx.contextId()));
    }
    @Test void validatesVersionAndArchiveAndRevision() {
        assertThrows(ApiException.class,()->service.capture(workspace,document,caller,null));
        assertThrows(ApiException.class,()->service.capture(workspace,document,caller,new Capture("2.0",request.clientRequestId(),3,null,null,null,null,request.target())));
        assertThrows(ApiException.class,()->service.capture(workspace,document,caller,new Capture("1.0",request.clientRequestId(),2,null,null,null,null,request.target())));
        assertThrows(ApiException.class,()->service.capture(workspace,document,caller,realtime(-1,0)));
        when(access.permitsSystemContentMaintenance(workspace)).thenReturn(false);assertThrows(ApiException.class,()->service.capture(workspace,document,caller,request));
    }
    @Test void rejectsMissingIdentityUnsafePositionsAndOversizedTransportBeforeStoring() {
        var id=request.clientRequestId();var target=request.target();
        var invalid=List.of(
            new Capture(null,id,3,null,null,null,null,target),
            new Capture("1.0",null,3,null,null,null,null,target),
            new Capture("1.0",id,0,null,null,null,null,target),
            new Capture("1.0",id,3,null,null,null,null,null),
            new Capture("1.0",id,3,0L,-1L,null,null,target),
            new Capture("1.0",id,3,0L,1L,"x".repeat(65537),relative(),target),
            new Capture("1.0",id,3,0L,1L,"AA==",new Relative(null,"AA=="),target),
            new Capture("1.0",id,3,0L,1L,"AA==",new Relative("AA==",null),target),
            new Capture("1.0",id,3,0L,1L,"AA==",new Relative("x".repeat(1025),"AA=="),target),
            new Capture("1.0",id,3,0L,1L,"AA==",new Relative("AA==","x".repeat(1025)),target));
        for(var capture:invalid)assertEquals(ApiErrorCode.VALIDATION_FAILED,assertThrows(ApiException.class,()->service.capture(workspace,document,caller,capture)).code());
        verify(store,never()).insert(any(),any(),any(),any());
    }
    Relative relative(){return new Relative("AA==","AA==");}
    @Test void requiresCompleteCollaborationIdentityAndKeepsArchivedDocumentsReadOnly(){
        when(state.snapshotState(document)).thenReturn(Optional.of(new DocumentSnapshotState.State(new byte[]{1},"x",2,5)));
        var target=request.target();var id=request.clientRequestId();
        for(var capture:List.of(
            new Capture("1.0",id,3,null,5L,"AA==",relative(),target),
            new Capture("1.0",id,3,2L,null,"AA==",relative(),target),
            new Capture("1.0",id,3,2L,5L,null,relative(),target),
            new Capture("1.0",id,3,2L,5L,"AA==",null,target)))
            assertEquals(ApiErrorCode.CONFLICT,assertThrows(ApiException.class,()->service.capture(workspace,document,caller,capture)).code());
        when(resolver.pin(any(),any())).thenReturn(new Resolution(target.start(),target.end()));
        assertThrows(ApiException.class,()->service.capture(workspace,document,caller,request));
        when(detail.summary().archivedAt()).thenReturn(Instant.now());assertThrows(ApiException.class,()->service.capture(workspace,document,caller,request));
    }
    @Test void revisionOnlyLegacyTargetCannotRebaseAndAnActivatedRoomCannotBeUsedAsLegacy(){
        var point=new Endpoint(null,request.target().start().path(),request.target().start().offset());
        var target=new Target(request.target().kind(),point,request.target().end(),request.target().hash());
        var ctx=new Context("1.0",context.contextId(),workspace,document,2,null,null,new Snapshot(target,"A😀B","","",List.of(),List.of()),context.createdAt());
        when(store.find(any(),any(),any())).thenReturn(Optional.of(new CanvasContextStore.Stored("x",request,ctx)));
        assertThrows(ApiException.class,()->service.resolve(workspace,document,caller,ctx.contextId()));
        when(state.snapshotState(document)).thenReturn(Optional.of(new DocumentSnapshotState.State(new byte[]{1},"x",2,5)));
        assertThrows(ApiException.class,()->service.resolve(workspace,document,caller,ctx.contextId()));
    }
    @Test void readsReauthorizeSourceVersionsChunksAndOutputs() {
        var snapshot=new Snapshot(request.target(),"x","","",List.of(new SourceReference(UUID.randomUUID(),UUID.randomUUID(),"a".repeat(64),"p1")),List.of(new AnalysisReference(UUID.randomUUID(),UUID.randomUUID(),"table")));
        var ctx=new Context("1.0",context.contextId(),workspace,document,3,null,null,snapshot,context.createdAt());
        when(store.find(any(),any(),any())).thenReturn(Optional.of(new CanvasContextStore.Stored("x",request,ctx)));
        service.find(workspace,document,caller,ctx.contextId());verify(sources).findVersion(eq(workspace),eq(caller),any(),any());verify(retrieval).chunk(eq(workspace),any(),any(),eq(caller),any(),any());verify(analyses).resolve(eq(workspace),eq(caller),argThat(list -> list.size()==1));
        doThrow(new ResourceNotFoundException("revoked")).when(documents).findOne(workspace,caller,document);
        assertThrows(ResourceNotFoundException.class,()->service.find(workspace,document,caller,ctx.contextId()));
    }
    @Test void reauthorizesUnversionedSourcesAndRejectsEvidenceWithoutRetrievalProvenance(){
        UUID source=UUID.randomUUID();
        var snapshot=new Snapshot(request.target(),"x","","",List.of(new SourceReference(source,null,null,null)),List.of());
        var ctx=new Context("1.0",context.contextId(),workspace,document,3,null,null,snapshot,context.createdAt());
        when(store.find(any(),any(),any())).thenReturn(Optional.of(new CanvasContextStore.Stored("x",request,ctx)));
        service.find(workspace,document,caller,ctx.contextId());verify(sources).findOne(workspace,caller,source);
        var broken=new Snapshot(request.target(),"x","","",List.of(new SourceReference(source,null,"chunk",null)),List.of());
        when(store.find(any(),any(),any())).thenReturn(Optional.of(new CanvasContextStore.Stored("x",request,new Context("1.0",ctx.contextId(),workspace,document,3,null,null,broken,ctx.createdAt()))));
        assertEquals(ApiErrorCode.VALIDATION_FAILED,assertThrows(ApiException.class,()->service.find(workspace,document,caller,ctx.contextId())).code());
    }
}
