package dev.researchhub.ai.observability;

import dev.researchhub.ai.application.*;
import dev.researchhub.ai.application.GenerationContracts.*;
import dev.researchhub.shared.error.*;
import dev.researchhub.workspace.application.WorkspaceAuthorizationService;
import org.junit.jupiter.api.*;
import org.mockito.ArgumentCaptor;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.*;
import static dev.researchhub.ai.observability.AiDiagnostics.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class AiDiagnosticsTest {
    final UUID workspace=UUID.randomUUID(), caller=UUID.randomUUID(), source=UUID.randomUUID();
    final ModelMetadata model=new ModelMetadata("fixture","model","1",true,false);
    final Usage usage=new Usage(1000,100,1100,false);
    final String content="Private source content",hash=RetrievalIdentity.hash(content);
    final RetrievalChunk chunk=new RetrievalChunk(hash,source,workspace,null,0,content,2,2,"Methods",hash,"retrieval:1",List.of(new SourceSpan("p2",0,content.length())));
    final RetrievalHit hit=new RetrievalHit(chunk,.7,.8,.2,new EmbeddingModel("fixture","embedding","1",4));
    final AiDiagnosticsStore store=mock(AiDiagnosticsStore.class);
    final AiDiagnosticsProperties properties=new AiDiagnosticsProperties();
    final WorkspaceAuthorizationService auth=mock(WorkspaceAuthorizationService.class);
    final SourceRetrievalService retrieval=mock(SourceRetrievalService.class);
    final AiObservation observer=new AiObservation(store,properties);
    final AiDiagnosticsService service=new AiDiagnosticsService(auth,properties,store,retrieval);
    ContextContracts.ContextualRequest request(String template) {
        var request=new Request("1.0",UUID.randomUUID(),template,hash,content,"Private query",new Parameters(0.0,1024),List.of(new Evidence(hash,hash,content)));
        return new GroundedContextBuilder().build(request,List.of(Citation.from(chunk,"Fixture source")),new ContextContracts.Budget(10000,10000,true));
    }
    void enable() { properties.setEnabled(true); properties.setCaptureContent(true); properties.setStaffIds(Set.of(caller)); }
    AiDiagnosticsProperties.Rate rate(String provider,String name,String version) { return new AiDiagnosticsProperties.Rate(provider,name,version,"2026-10",new BigDecimal("2"),new BigDecimal("8")); }
    @Test void priceIsVersionedAndUnknownNeverBecomesZero() {
        assertFalse(properties.isEnabled()); assertFalse(properties.isCaptureContent()); assertTrue(properties.getStaffIds().isEmpty());
        assertNull(properties.estimate(null)); assertNull(properties.estimate(new ProviderUsage(null,usage))); assertNull(properties.estimate(new ProviderUsage(model,null)));
        properties.setRates(List.of(rate("other","model","1"),rate("fixture","other","1"),rate("fixture","model","2")));
        assertNull(properties.estimate(new ProviderUsage(model,usage)));
        properties.setRates(List.of(rate("fixture","model","1")));
        var cost=properties.estimate(new ProviderUsage(model,usage)); assertEquals(new BigDecimal("0.0028000000"),cost.usd()); assertTrue(cost.estimated()); assertEquals("2026-10",cost.pricingVersion());
        assertEquals(1,properties.getRates().size());
        assertThrows(IllegalArgumentException.class,()->properties.setRates(List.of(rate("fixture","model","1"),rate("fixture","model","1"))));
        for (String invalid:List.of("", "x".repeat(129))) assertThrows(IllegalArgumentException.class,()->rate(invalid,"model","1"));
        for (String invalid:List.of("-1","1000001")) assertThrows(IllegalArgumentException.class,()->new AiDiagnosticsProperties.Rate("p","m","v","r",new BigDecimal(invalid),BigDecimal.ZERO));
    }
    @Test void eachFeatureHasSeparateMetadataIncludingFailuresWithKnownUsage() {
        var templates=List.of("workspace-question:2","authoring-draft:1","authoring-rewrite:1","authoring-evidence:1","source-summary:1","computation-plan:3","grounded-response:2");
        for (var template:templates) {
            var request=request(template);
            try (var call=observer.call(workspace,request)) { call.result(model,usage); call.success(); call.close(); }
        }
        var values=ArgumentCaptor.forClass(UsageEvent.class); verify(store,times(7)).usage(values.capture());
        assertEquals(Set.of(Feature.values()),new HashSet<>(values.getAllValues().stream().map(UsageEvent::feature).toList()));
        assertTrue(values.getAllValues().stream().allMatch(v->v.status().equals("SUCCEEDED") && v.errorCode()==null && v.latencyMs()>=0));
        try (var call=observer.call(workspace,request("workspace-question:2"))) { call.failure(new ModelFailure(ApiErrorCode.AI_REFUSED,new ProviderUsage(model,usage))); }
        verify(store,times(8)).usage(values.capture()); var failed=values.getValue(); assertEquals("FAILED",failed.status()); assertEquals("AI_REFUSED",failed.errorCode()); assertEquals(usage,failed.usage());
        try (var call=observer.call(workspace,request("workspace-question:2"))) { call.failure(new ModelFailure(ApiErrorCode.AI_UNAVAILABLE)); }
        verify(store,times(9)).usage(values.capture()); assertNull(values.getValue().usage()); assertNull(values.getValue().model());
    }
    @Test void tracesContainOnlyAuthorizedHitsAndPrivateCaptureIsIndependent() {
        var question=new QuestionContracts.Question("Private query",null);
        try (var trace=observer.question(workspace,caller,question,6,new Parameters(null,1024),"workspace-question:2",hash)) {
            trace.retrieved(List.of(hit));
            try (var call=observer.call(workspace,request("workspace-question:2"))) { call.result(model,usage); call.success(); }
            trace.response(new QuestionContracts.Response("INSUFFICIENT_EVIDENCE","NO_RETRIEVED_EVIDENCE","No evidence",List.of(),null));
        }
        var traces=ArgumentCaptor.forClass(Trace.class); verify(store,times(4)).trace(traces.capture()); var trace=traces.getValue();
        assertNull(trace.query()); assertNull(trace.response()); assertNotNull(trace.context()); assertEquals(1,trace.hits().size()); assertNotNull(trace.generationRequestId());
        enable();
        try (var outer=observer.question(workspace,caller,question,6,new Parameters(0.0,1024),"workspace-question:2",hash)) {
            try (var inner=observer.question(workspace,caller,question,6,new Parameters(0.0,1024),"workspace-question:2",hash)) { inner.failure(new ModelFailure(ApiErrorCode.AI_UNAVAILABLE)); }
            try (var call=observer.call(workspace,request("workspace-question:2"))) { call.success(); }
            outer.response(new QuestionContracts.Response("INSUFFICIENT_EVIDENCE","NO_RETRIEVED_EVIDENCE","No evidence",List.of(),null));
        }
        verify(store,times(9)).trace(traces.capture()); assertEquals("Private query",traces.getValue().query()); assertNotNull(traces.getValue().response());
        try (var ignored=observer.question(workspace,caller,question,6,new Parameters(0.0,1024),"workspace-question:2",hash)) { /* interrupted caller */ }
        verify(store,times(11)).trace(traces.capture()); assertEquals("FAILED",traces.getValue().status());
    }
    Trace trace(String query,ContextContracts.Summary context,UUID generation) {
        return new Trace(UUID.randomUUID(),workspace,"request-1",Instant.now(),query,null,List.of(),6,new Parameters(0.0,1024),"workspace-question:2",hash,"FAILED","AI_REFUSED",4L,List.of(new Hit(Citation.from(chunk),.7,.8,.2,hit.model(),content.length())),generation,context,null);
    }
    @Test void diagnosticsRequireOperatorAndMembershipAndRedactImmediatelyWhenCaptureIsDisabled() {
        assertThrows(ResourceNotFoundException.class,()->service.overview(workspace,caller,30)); verifyNoInteractions(store,auth);
        properties.setEnabled(true); assertThrows(ResourceNotFoundException.class,()->service.overview(workspace,caller,30));
        enable();
        for (int days:List.of(0,91)) assertThrows(ApiException.class,()->service.overview(workspace,caller,days));
        var trace=trace("Private query",request("workspace-question:2").context().summary(),UUID.randomUUID());
        when(store.trace(workspace,trace.id())).thenReturn(Optional.of(trace)); when(store.usage(workspace,trace.generationRequestId())).thenReturn(Optional.empty());
        when(retrieval.chunk(workspace,source,null,caller,hash,chunk.processingVersion())).thenReturn(chunk);
        var detail=service.detail(workspace,caller,trace.id()); assertEquals(content,detail.chunks().getFirst().text()); assertEquals("S1",detail.chunks().getFirst().citationKey()); assertEquals("NOT_APPLICABLE",detail.reranking());
        when(store.aggregate(eq(workspace),any())).thenReturn(List.of()); when(store.traces(eq(workspace),any())).thenReturn(List.of(new TraceSummary(trace.id(),trace.correlationId(),trace.startedAt(),trace.status(),trace.errorCode(),trace.generationRequestId(),trace.query(),1)));
        assertEquals("Private query",service.overview(workspace,caller,7).traces().getFirst().query());
        properties.setCaptureContent(false);
        assertNull(service.detail(workspace,caller,trace.id()).trace().query()); assertNull(service.detail(workspace,caller,trace.id()).chunks().getFirst().text()); assertNull(service.overview(workspace,caller,90).traces().getFirst().query());
        assertThrows(ResourceNotFoundException.class,()->service.detail(workspace,caller,UUID.randomUUID()));
        doThrow(new ResourceNotFoundException("Workspace was not found")).when(auth).requireContentReader(workspace,caller);
        assertThrows(ResourceNotFoundException.class,()->service.detail(workspace,caller,trace.id()));
    }
    @Test void staleMissingForeignAndUncapturedChunksNeverExposeText() {
        enable(); var trace=trace("Q",null,null); when(store.trace(workspace,trace.id())).thenReturn(Optional.of(trace));
        when(retrieval.chunk(workspace,source,null,caller,hash,chunk.processingVersion())).thenThrow(new ConflictException("Changed"));
        assertEquals("SOURCE_UNAVAILABLE",service.detail(workspace,caller,trace.id()).chunks().getFirst().availability());
        var foreign=new RetrievalChunk(hash,source,UUID.randomUUID(),null,0,content,2,2,"Methods",hash,"retrieval:1",chunk.spans());
        doReturn(foreign).when(retrieval).chunk(workspace,source,null,caller,hash,chunk.processingVersion());
        assertNull(service.detail(workspace,caller,trace.id()).chunks().getFirst().text());
        var changed=new RetrievalChunk(hash,source,workspace,null,0,content,3,3,"Methods",hash,"retrieval:1",chunk.spans());
        doReturn(changed).when(retrieval).chunk(workspace,source,null,caller,hash,chunk.processingVersion());
        assertNull(service.detail(workspace,caller,trace.id()).chunks().getFirst().text());
        var uncaptured=trace(null,null,null); when(store.trace(workspace,uncaptured.id())).thenReturn(Optional.of(uncaptured));
        assertEquals("CONTENT_CAPTURE_DISABLED",service.detail(workspace,caller,uncaptured.id()).chunks().getFirst().availability());
    }
}
