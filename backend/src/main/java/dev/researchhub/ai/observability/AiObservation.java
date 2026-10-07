package dev.researchhub.ai.observability;

import dev.researchhub.ai.application.*;
import dev.researchhub.ai.application.GenerationContracts.*;
import dev.researchhub.shared.error.*;
import dev.researchhub.shared.observability.CorrelationContext;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Service;
import java.time.Instant;
import java.util.*;
import static dev.researchhub.ai.observability.AiDiagnostics.*;

/** Per-call metadata, independent of private-content capture. No provider body or exception is retained. */
@Service
@Profile("local")
public class AiObservation {
    private final AiDiagnosticsStore store;
    private final AiDiagnosticsProperties properties;
    private final ThreadLocal<QuestionTrace> question = new ThreadLocal<>();
    public AiObservation(AiDiagnosticsStore store, AiDiagnosticsProperties properties) { this.store=store; this.properties=properties; }
    /** Standalone application unit tests can opt out; Spring always injects the persistent observer. */
    public static AiObservation none() { return new AiObservation(null,new AiDiagnosticsProperties()); }
    public Call call(UUID workspace, ContextContracts.ContextualRequest request) {
        var current=question.get();
        if (current!=null) { current.generation=request.request().requestId(); current.context=request.context().summary(); current.save(); }
        return call(workspace,request.request());
    }
    public Call call(UUID workspace, Request request) { return new Call(workspace,request); }
    public QuestionTrace question(UUID workspace, UUID caller, QuestionContracts.Question input, int topK, Parameters parameters, String templateId, String templateHash) {
        return new QuestionTrace(workspace,caller,input,topK,parameters,templateId,templateHash);
    }
    private void save(Trace trace) { if (store!=null) store.trace(trace); }
    private static long elapsed(long start) { return Math.max(0,(System.nanoTime()-start)/1_000_000); }
    static Feature feature(String template) {
        if (template.startsWith("workspace-question:")) return Feature.ASK_WORKSPACE;
        if (template.startsWith("authoring-draft:")) return Feature.SECTION_GENERATION;
        if (template.startsWith("authoring-rewrite:")) return Feature.REWRITE;
        if (template.startsWith("authoring-evidence:")) return Feature.EVIDENCE_SEARCH;
        if (template.startsWith("computation-plan:")) return Feature.ANALYSIS_PLANNING;
        if (template.startsWith("source-")) return Feature.SOURCE_ANALYSIS;
        return Feature.GROUNDED_RESPONSE;
    }
    public final class Call implements AutoCloseable {
        private final UUID workspace;
        private final Request request;
        private final Instant started=Instant.now();
        private final long start=System.nanoTime();
        private final String correlation=CorrelationContext.currentOrNew();
        private ProviderUsage value;
        private Long latency;
        private String status="FAILED", error="AI_PROVIDER_ERROR";
        private boolean closed;
        private Call(UUID workspace,Request request) { this.workspace=workspace; this.request=request; }
        public void result(ModelMetadata model, Usage usage) { value=new ProviderUsage(model,usage); latency=elapsed(start); }
        public void success() { status="SUCCEEDED"; error=null; }
        public void failure(ApiException failure) {
            error=failure.code().name();
            if (failure instanceof ModelFailure model && model.telemetry()!=null) value=model.telemetry();
        }
        @Override public void close() {
            if (closed) return;
            closed=true;
            if (store!=null) store.usage(new UsageEvent(request.requestId(),workspace,correlation,feature(request.templateId()),
                request.templateId(),request.templateHash(),value==null ? null : value.model(),value==null ? null : value.usage(),
                latency==null ? elapsed(start) : latency,properties.estimate(value),status,error,started));
        }
    }
    public final class QuestionTrace implements AutoCloseable {
        private final QuestionTrace previous=question.get();
        private final UUID id=UUID.randomUUID(),workspace;
        private final String correlation=CorrelationContext.currentOrNew();
        private final Instant started=Instant.now();
        private final long start=System.nanoTime();
        private final QuestionContracts.Question input;
        private final int topK;
        private final Parameters parameters;
        private final String templateId,templateHash,query;
        private String status="RUNNING",error;
        private Long retrievalLatency;
        private List<Hit> hits=List.of();
        private UUID generation;
        private ContextContracts.Summary context;
        private QuestionContracts.Response response;
        private QuestionTrace(UUID workspace,UUID caller,QuestionContracts.Question input,int topK,Parameters parameters,String templateId,String templateHash) {
            this.workspace=workspace; this.input=input; this.topK=topK; this.parameters=parameters; this.templateId=templateId; this.templateHash=templateHash;
            query=properties.staff(caller) && properties.isCaptureContent() ? input.question() : null;
            save(); question.set(this);
        }
        public void retrieved(List<RetrievalHit> values) {
            retrievalLatency=elapsed(start);
            hits=values.stream().map(h->new Hit(Citation.from(h.chunk()),h.score(),h.vectorSimilarity(),h.lexicalScore(),h.model(),
                h.chunk().content().getBytes(java.nio.charset.StandardCharsets.UTF_8).length)).toList();
            save();
        }
        public void response(QuestionContracts.Response value) { status=value.status(); if (query!=null) response=value; }
        public void failure(ApiException failure) { status="FAILED"; error=failure.code().name(); }
        private void save() { AiObservation.this.save(new Trace(id,workspace,correlation,started,query,input.selectedSourceIds(),input.selectedAnalysisOutputs(),
            topK,parameters,templateId,templateHash,status,error,retrievalLatency,hits,generation,context,response)); }
        @Override public void close() {
            question.set(previous);
            if (previous==null) question.remove();
            if ("RUNNING".equals(status)) { status="FAILED"; error="AI_PROVIDER_ERROR"; }
            if (retrievalLatency==null) retrievalLatency=elapsed(start);
            save();
        }
    }
}
