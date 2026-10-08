package dev.researchhub.ai.observability;

import dev.researchhub.ai.application.*;
import dev.researchhub.shared.error.*;
import dev.researchhub.workspace.application.WorkspaceAuthorizationService;
import org.springframework.stereotype.Service;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.*;
import static dev.researchhub.ai.observability.AiDiagnostics.*;

@Service
public class AiDiagnosticsService {
    private final WorkspaceAuthorizationService authorization;
    private final AiDiagnosticsProperties properties;
    private final AiDiagnosticsStore store;
    private final SourceRetrievalService retrieval;
    public AiDiagnosticsService(WorkspaceAuthorizationService authorization,AiDiagnosticsProperties properties,AiDiagnosticsStore store,SourceRetrievalService retrieval) {
        this.authorization=authorization; this.properties=properties; this.store=store; this.retrieval=retrieval;
    }
    private void authorize(UUID workspace,UUID caller) {
        if (!properties.staff(caller)) throw new ResourceNotFoundException("AI diagnostics were not found");
        authorization.requireContentReader(workspace,caller);
    }
    public Overview overview(UUID workspace,UUID caller,int days) {
        authorize(workspace,caller);
        if (days<1 || days>90) throw new ApiException(ApiErrorCode.VALIDATION_FAILED,"Choose a usage window between 1 and 90 days");
        var since=Instant.now().minus(days,ChronoUnit.DAYS);
        var usage=store.aggregate(workspace,since);
        var traces=store.traces(workspace,since).stream().map(t -> new TraceSummary(t.id(),t.correlationId(),t.startedAt(),t.status(),t.errorCode(),t.generationRequestId(),properties.isCaptureContent() ? t.query() : null,t.retrievedChunks())).toList();
        authorize(workspace,caller);
        return new Overview(days,properties.isCaptureContent(),usage,traces);
    }
    public Detail detail(UUID workspace,UUID caller,UUID id) {
        authorize(workspace,caller);
        var trace=store.trace(workspace,id).orElseThrow(()->new ResourceNotFoundException("AI diagnostics were not found"));
        var chunks=trace.hits().stream().map(hit->chunk(workspace,caller,trace,hit)).toList();
        authorize(workspace,caller);
        var exposed=properties.isCaptureContent() ? trace : new Trace(trace.id(),trace.workspaceId(),trace.correlationId(),trace.startedAt(),null,
            trace.selectedSourceIds(),trace.selectedAnalysisOutputs(),trace.topK(),trace.parameters(),trace.templateId(),trace.templateHash(),trace.status(),trace.errorCode(),
            trace.retrievalLatencyMs(),trace.hits(),trace.generationRequestId(),trace.context(),null);
        return new Detail(exposed,trace.generationRequestId()==null ? null : store.usage(workspace,trace.generationRequestId()).orElse(null),
            chunks,"hybrid-vector-lexical","NOT_APPLICABLE");
    }
    private Chunk chunk(UUID workspace,UUID caller,Trace trace,Hit hit) {
        var citation=hit.citation();
        String text=null,availability="CONTENT_CAPTURE_DISABLED";
        if (trace.query()!=null && properties.isCaptureContent()) {
            try {
                var value=retrieval.chunk(workspace,citation.sourceId(),citation.sourceVersionId(),caller,citation.chunkId(),citation.processingVersion());
                // Fail closed even if an adapter violates the authorized lookup contract.
                if (!workspace.equals(value.workspaceId()) || !citation.equals(GenerationContracts.Citation.from(value))) throw new ResourceNotFoundException("Source evidence was not found");
                text=value.content(); availability="AVAILABLE";
            } catch (ResourceNotFoundException | ConflictException unavailable) { availability="SOURCE_UNAVAILABLE"; }
        }
        var binding=trace.context()==null ? null : trace.context().citations().stream().filter(b->b.chunkId().equals(citation.chunkId())).findFirst().orElse(null);
        return new Chunk(hit,text,availability,binding==null ? null : binding.citationKey(),binding==null ? null : binding.textReference());
    }
}
