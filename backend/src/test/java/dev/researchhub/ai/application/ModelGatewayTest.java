package dev.researchhub.ai.application;

import dev.researchhub.ai.application.GenerationContracts.*;
import dev.researchhub.ai.application.ContextContracts.*;
import dev.researchhub.shared.error.*;
import dev.researchhub.workspace.application.WorkspaceAuthorizationService;
import org.junit.jupiter.api.*;
import org.mockito.ArgumentCaptor;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;

class ModelGatewayTest {
    private final UUID workspace = UUID.randomUUID(), caller = UUID.randomUUID(), source = UUID.randomUUID();
    private final ModelProvider provider = mock(ModelProvider.class);
    private final SourceRetrievalService retrieval = mock(SourceRetrievalService.class);
    private final WorkspaceAuthorizationService auth = mock(WorkspaceAuthorizationService.class);
    private final GenerationStore store = mock(GenerationStore.class);
    private ModelGateway gateway;
    private final dev.researchhub.source.application.SourceService sources = mock(dev.researchhub.source.application.SourceService.class);
    private RetrievalChunk chunk;
    private Command command;
    private GenerationFeature feature;

    @BeforeEach void prepare() throws Exception {
        feature = new GenerationFeature("grounded-response:2", "0", 1024);
        gateway = new ModelGateway(provider, retrieval, auth, feature, store, new GroundedContextBuilder(), new ContextProperties(32768,24576,true), sources, mock(AuthoringModelProvider.class), mock(SourceAnalysisModelProvider.class));
        chunk = new RetrievalChunk("a".repeat(64), source, workspace, null, 0, "Supported fact.", 2, 2, "Theory",
            RetrievalIdentity.hash("Supported fact."), "retrieval-1:test", List.of(new SourceSpan("unit-2", 0, 15)));
        when(sources.findOne(workspace, caller, source)).thenReturn(new dev.researchhub.source.application.SourceSummary(source, workspace, "lecture.pdf", "Lecture", "application/pdf", "PDF", 20, "hash", "READY", null, caller, java.time.Instant.now(), java.time.Instant.now()));
        command = new Command("Summarize this evidence", List.of(new EvidenceReference(source, chunk.chunkId(), chunk.processingVersion())));
        when(retrieval.chunk(workspace, source, caller, chunk.chunkId(), chunk.processingVersion())).thenReturn(chunk);
        when(provider.generateStructured(any(ContextualRequest.class))).thenAnswer(invocation -> result(((ContextualRequest) invocation.getArgument(0)).request(), chunk.chunkId()));
    }
    private Result result(Request request, String evidenceId) {
        return new Result("1.0", request.requestId(), request.templateId(), request.templateHash(),
            new ModelMetadata("alternate-cloud", "model", "immutable-1", true, false), new Usage(20, 10, 30, false), "provider-request",
            new Answer("SUPPORTED", List.of(new Claim("Supported fact.", List.of(evidenceId)))));
    }
    @Test void resolvesAuthorizedEvidenceUsesFeatureConfigurationAndPersistsAttributableResponse() {
        var response = gateway.generate(workspace, caller, command);
        var request = ArgumentCaptor.forClass(ContextualRequest.class);
        verify(provider).generateStructured(request.capture());
        assertEquals(feature.templateId(), request.getValue().request().templateId());
        assertEquals(feature.templateHash(), request.getValue().request().templateHash());
        assertEquals(new Parameters(0.0, 1024), request.getValue().request().parameters());
        assertEquals(List.of(new Evidence(chunk.chunkId(), chunk.contentHash(), chunk.content())), request.getValue().request().evidence());
        assertEquals(List.of(Citation.from(chunk,"Lecture")), response.evidence());
        assertEquals("alternate-cloud", response.result().model().provider());
        assertEquals(30, response.result().usage().totalTokens());
        var order = inOrder(auth, store, provider);
        order.verify(auth).requireContentReader(workspace, caller);
        order.verify(store).begin(eq(workspace), eq(caller), any(), eq(response.evidence()));
        order.verify(provider).generateStructured(any(ContextualRequest.class));
        order.verify(auth).requireContentReader(workspace, caller);
        order.verify(store).succeed(workspace, response);
        verify(store, never()).fail(any(), any(), any());
    }
    @Test void doesNotSendUnauthorizedOrStaleEvidenceToTheProvider() {
        doThrow(new ResourceNotFoundException("missing")).when(auth).requireContentReader(workspace, caller);
        assertThrows(ResourceNotFoundException.class, () -> gateway.generate(workspace, caller, command));
        verifyNoInteractions(provider, retrieval, store);
        reset(auth);
        when(retrieval.chunk(any(), any(), any(), any(), any())).thenThrow(new ConflictException("stale"));
        assertThrows(ConflictException.class, () -> gateway.generate(workspace, caller, command));
        verifyNoInteractions(provider, store);
    }
    @Test void rejectsInventedCitationsAndRequestIdentityBeforePublishing() {
        doAnswer(invocation -> result(((ContextualRequest) invocation.getArgument(0)).request(), "b".repeat(64))).when(provider).generateStructured(any(ContextualRequest.class));
        var error = assertThrows(ModelFailure.class, () -> gateway.generate(workspace, caller, command));
        assertEquals(ApiErrorCode.AI_OUTPUT_INVALID, error.code());
        verify(store).fail(eq(workspace), any(), eq(error.code()));
        verify(store, never()).succeed(any(), any());
    }
    @Test void rejectsMissingResult() {
        doReturn(null).when(provider).generateStructured(any(ContextualRequest.class));
        assertEquals(ApiErrorCode.AI_OUTPUT_INVALID, assertThrows(ModelFailure.class, () -> gateway.generate(workspace, caller, command)).code());
    }
    @Test void contextOverflowStopsBeforeProviderAndAuditAndMetadataCalls() {
        gateway = new ModelGateway(provider, retrieval, auth, feature, store, new GroundedContextBuilder(), new ContextProperties(32768,64,true), sources, mock(AuthoringModelProvider.class), mock(SourceAnalysisModelProvider.class));
        assertEquals(ApiErrorCode.AI_CONTEXT_TOO_LARGE, assertThrows(ApiException.class, () -> gateway.generate(workspace, caller, command)).code());
        verifyNoInteractions(provider, store);
    }
    @Test void providerFailuresBecomeSafeAuditedApplicationErrors() {
        doThrow(new ModelFailure(ApiErrorCode.AI_UNAVAILABLE)).when(provider).generateStructured(any(ContextualRequest.class));
        assertEquals(ApiErrorCode.AI_UNAVAILABLE, assertThrows(ModelFailure.class, () -> gateway.generate(workspace, caller, command)).code());
        verify(store).fail(eq(workspace), any(), eq(ApiErrorCode.AI_UNAVAILABLE));
        doThrow(new IllegalStateException("private prompt and API key")).when(provider).generateStructured(any(ContextualRequest.class));
        var error = assertThrows(ModelFailure.class, () -> gateway.generate(workspace, caller, command));
        assertEquals(ApiErrorCode.AI_PROVIDER_ERROR, error.code()); assertNull(error.getCause()); assertFalse(error.getMessage().contains("private"));
        verify(store).fail(eq(workspace), any(), eq(ApiErrorCode.AI_PROVIDER_ERROR));
    }
    @Test void revalidatesVersionsAndMembershipAfterTheRemoteCall() {
        when(retrieval.chunk(any(), any(), any(), any(), any())).thenReturn(chunk).thenThrow(new ConflictException("reprocessed"));
        assertThrows(ConflictException.class, () -> gateway.generate(workspace, caller, command));
        verify(store).fail(eq(workspace), any(), eq(ApiErrorCode.CONFLICT));
        doReturn(chunk).when(retrieval).chunk(any(), any(), any(), any(), any());
        doNothing().doThrow(new ResourceNotFoundException("revoked")).when(auth).requireContentReader(workspace, caller);
        assertThrows(ResourceNotFoundException.class, () -> gateway.generate(workspace, caller, command));
        verify(store).fail(eq(workspace), any(), eq(ApiErrorCode.RESOURCE_NOT_FOUND));
        verify(store, never()).succeed(any(), any());
    }
    @Test void changedContextIsNotPublishedAndExcessiveProvenanceIsBounded() {
        var changed = new RetrievalChunk(chunk.chunkId(), source, workspace, null, 0, "changed", 2, 2, null,
            RetrievalIdentity.hash("changed"), chunk.processingVersion(), chunk.spans());
        when(retrieval.chunk(any(), any(), any(), any(), any())).thenReturn(chunk, changed);
        assertThrows(ConflictException.class, () -> gateway.generate(workspace, caller, command));
        var excessive = new RetrievalChunk(chunk.chunkId(), source, workspace, null, 0, chunk.content(), 2, 2, null,
            chunk.contentHash(), chunk.processingVersion(), Collections.nCopies(1025, chunk.spans().getFirst()));
        when(retrieval.chunk(any(), any(), any(), any(), any())).thenReturn(excessive);
        assertEquals(ApiErrorCode.VALIDATION_FAILED, assertThrows(ApiException.class, () -> gateway.generate(workspace, caller, command)).code());
        verify(provider, times(1)).generateStructured(any(ContextualRequest.class));
    }
    @Test void metadataAndSavedResponsesAlwaysAuthorizeTheWorkspace() {
        var model = new ModelMetadata("cloud", "model", "1", true, false);
        when(provider.modelMetadata()).thenReturn(model);
        assertEquals(model, gateway.modelMetadata(workspace, caller));
        var generated = gateway.generate(workspace, caller, command);
        when(store.findCompleted(workspace, generated.result().requestId())).thenReturn(Optional.of(generated));
        assertEquals(generated, gateway.find(workspace, caller, generated.result().requestId()));
        when(store.findCompleted(eq(workspace), any())).thenReturn(Optional.empty());
        assertThrows(ResourceNotFoundException.class, () -> gateway.find(workspace, caller, UUID.randomUUID()));
        when(provider.modelMetadata()).thenThrow(new ModelFailure(ApiErrorCode.AI_UNAVAILABLE));
        assertEquals(ApiErrorCode.AI_UNAVAILABLE, assertThrows(ModelFailure.class, () -> gateway.modelMetadata(workspace, caller)).code());
        doThrow(new IllegalStateException("secret")).when(provider).modelMetadata();
        assertEquals(ApiErrorCode.AI_PROVIDER_ERROR, assertThrows(ModelFailure.class, () -> gateway.modelMetadata(workspace, caller)).code());
    }
    @Test void analysisBoundaryRejectsInvalidIdentityAndReturnsOnlySafeProviderFailures() throws Exception {
        var json=new tools.jackson.databind.ObjectMapper();
        var folder=java.nio.file.Path.of("../contracts/ai/source-analysis/v1");
        var request=json.readValue(java.nio.file.Files.readString(folder.resolve("comparison-model-request.json")),ContextualRequest.class);
        var result=json.readValue(java.nio.file.Files.readString(folder.resolve("comparison-model-result.json")),SourceAnalysisContracts.Result.class);
        var ids=result.answer().rows().stream().map(SourceAnalysisContracts.Row::sourceId).toList();
        var criteria=result.answer().rows().getFirst().cells().stream().map(SourceAnalysisContracts.Cell::criterion).toList();
        var mapping=Map.of("a".repeat(64),ids.getFirst(),"b".repeat(64),ids.getLast());
        var analyses=mock(SourceAnalysisModelProvider.class);
        gateway=new ModelGateway(provider,retrieval,auth,feature,store,new GroundedContextBuilder(),new ContextProperties(32768,24576,true),sources,mock(AuthoringModelProvider.class),analyses);
        when(analyses.analyze(request)).thenReturn(result);
        assertEquals(result,gateway.analyze(workspace,caller,request,SourceAnalysisContracts.Kind.COMPARISON,ids,criteria,mapping));
        when(analyses.analyze(request)).thenReturn(null);
        assertEquals(ApiErrorCode.AI_OUTPUT_INVALID,assertThrows(ModelFailure.class,() -> gateway.analyze(workspace,caller,request,SourceAnalysisContracts.Kind.COMPARISON,ids,criteria,mapping)).code());
        doThrow(new ModelFailure(ApiErrorCode.AI_UNAVAILABLE)).when(analyses).analyze(request);
        assertEquals(ApiErrorCode.AI_UNAVAILABLE,assertThrows(ModelFailure.class,() -> gateway.analyze(workspace,caller,request,SourceAnalysisContracts.Kind.COMPARISON,ids,criteria,mapping)).code());
        doThrow(new IllegalStateException("private prompt")).when(analyses).analyze(request);
        var safe=assertThrows(ModelFailure.class,() -> gateway.analyze(workspace,caller,request,SourceAnalysisContracts.Kind.COMPARISON,ids,criteria,mapping));
        assertEquals(ApiErrorCode.AI_PROVIDER_ERROR,safe.code());assertFalse(safe.getMessage().contains("private"));
        doReturn(result).when(analyses).analyze(request);
        var wrong=new SourceAnalysisContracts.Result(result.schemaVersion(),UUID.randomUUID(),result.templateId(),result.templateHash(),result.model(),result.usage(),result.providerRequestId(),result.answer());
        doReturn(wrong).when(analyses).analyze(request);
        assertEquals(ApiErrorCode.AI_OUTPUT_INVALID,assertThrows(ModelFailure.class,() -> gateway.analyze(workspace,caller,request,SourceAnalysisContracts.Kind.COMPARISON,ids,criteria,mapping)).code());
        doReturn(result).when(analyses).analyze(request);
        doNothing().doThrow(new ResourceNotFoundException("revoked")).when(auth).requireContentReader(workspace,caller);
        assertThrows(ResourceNotFoundException.class,() -> gateway.analyze(workspace,caller,request,SourceAnalysisContracts.Kind.COMPARISON,ids,criteria,mapping));
    }

}
