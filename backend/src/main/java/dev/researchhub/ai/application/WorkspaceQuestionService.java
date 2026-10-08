package dev.researchhub.ai.application;

import dev.researchhub.ai.application.GenerationContracts.*;
import dev.researchhub.ai.application.QuestionContracts.*;
import dev.researchhub.shared.error.ApiErrorCode;
import dev.researchhub.workspace.application.WorkspaceAuthorizationService;
import org.springframework.stereotype.Service;
import java.util.*;
import java.util.stream.Collectors;

/** Question -> scoped retrieval -> the shared grounded gateway. No vendor/storage access here. */
@Service
public class WorkspaceQuestionService {
    public static final String NO_EVIDENCE = "No searchable evidence was found in the authorized sources for this question.";
    public static final String INSUFFICIENT = "The supplied evidence does not contain enough information to answer this question.";
    @org.springframework.beans.factory.annotation.Autowired
    private dev.researchhub.ai.observability.AiObservation observation=dev.researchhub.ai.observability.AiObservation.none();
    private final WorkspaceAuthorizationService authorization;
    private final RetrievalSearchService retrieval;
    private final ModelGateway gateway;
    private final QuestionFeature feature;
    public WorkspaceQuestionService(WorkspaceAuthorizationService authorization, RetrievalSearchService retrieval,
                                    ModelGateway gateway, QuestionFeature feature) {
        this.authorization = authorization; this.retrieval = retrieval; this.gateway = gateway; this.feature = feature;
    }
    public Response answer(UUID workspaceId, UUID callerId, Question question) {
        return answer(workspaceId,callerId,question,QuestionExecution.NONE);
    }
    public Response answer(UUID workspaceId, UUID callerId, Question question, QuestionExecution execution) {
        execution.checkpoint();
        authorization.requireContentReader(workspaceId, callerId);
        try (var trace=observation.question(workspaceId,callerId,question,Math.min(feature.topK(),12-question.selectedAnalysisOutputs().size()),feature.parameters(),feature.templateId(),feature.templateHash())) {
            try { var response=answerObserved(workspaceId,callerId,question,execution,trace); trace.response(response); return response; }
            catch (dev.researchhub.shared.error.ApiException failure) { trace.failure(failure); throw failure; }
        }
    }
    private Response answerObserved(UUID workspaceId,UUID callerId,Question question,QuestionExecution execution,dev.researchhub.ai.observability.AiObservation.QuestionTrace trace) {
        // Search validates every selected source before embedding; workspace/source filters are in SQL.
        List<RetrievalHit> hits;
        try { hits = retrieval.search(question.question(), workspaceId, question.selectedSourceIds(), Math.min(feature.topK(),12-question.selectedAnalysisOutputs().size()), callerId); }
        catch (EmbeddingFailure failure) { throw new ModelFailure(failure.retryable() ? ApiErrorCode.AI_UNAVAILABLE : ApiErrorCode.AI_PROVIDER_ERROR); }
        execution.checkpoint();
        authorization.requireContentReader(workspaceId,callerId);
        execution.retrievalCompleted(hits.size());
        if (hits.isEmpty() && question.selectedAnalysisOutputs().isEmpty()) {
            authorization.requireContentReader(workspaceId, callerId);
            trace.retrieved(hits);
            return new Response("INSUFFICIENT_EVIDENCE", "NO_RETRIEVED_EVIDENCE", NO_EVIDENCE, List.of(), null);
        }
        // Fail closed if an adapter violates its scope. This does not filter global search results.
        if (hits.size() > Math.min(feature.topK(),12-question.selectedAnalysisOutputs().size()) || hits.stream().anyMatch(hit -> !workspaceId.equals(hit.chunk().workspaceId())
                || question.selectedSourceIds() != null && !question.selectedSourceIds().contains(hit.chunk().sourceId()))
                || hits.stream().map(hit -> hit.chunk().chunkId()).distinct().count() != hits.size()) throw invalid();
        trace.retrieved(hits);
        var references = hits.stream().map(hit -> new EvidenceReference(hit.chunk().sourceId(), hit.chunk().chunkId(), hit.chunk().processingVersion())).toList();
        var command=new Command(question.question(),references);
        var generated = question.selectedAnalysisOutputs().isEmpty() ? gateway.generate(workspaceId, callerId,command,feature)
            : gateway.generate(workspaceId,callerId,command,feature,question.selectedAnalysisOutputs());
        execution.checkpoint();
        var chunks = hits.stream().collect(Collectors.toMap(hit -> hit.chunk().chunkId(), RetrievalHit::chunk));
        if (generated.evidence().size() != chunks.size() || generated.evidence().stream().anyMatch(citation -> {
            var chunk = chunks.get(citation.chunkId());
            return chunk == null || !Citation.from(chunk, citation.title()).equals(citation);
        })) throw invalid();
        var answer = generated.result().answer();
        var citedIds = answer.claims().stream().flatMap(claim -> claim.evidenceIds().stream()).collect(Collectors.toSet());
        var allowed=new HashSet<>(chunks.keySet());
        if (generated.analysisEvidence().size()!=question.selectedAnalysisOutputs().size() || generated.analysisEvidence().stream().anyMatch(c ->
            !workspaceId.equals(c.workspaceId()) || !question.selectedAnalysisOutputs().contains(new dev.researchhub.analysis.application.AnalysisEvidenceService.Reference(c.analysisId(),c.executionId(),c.outputId())) || !allowed.add(c.evidenceId()))) throw invalid();
        if (!allowed.containsAll(citedIds)) throw invalid();
        if ("INSUFFICIENT_EVIDENCE".equals(answer.status()))
            return new Response(answer.status(), "INSUFFICIENT_RETRIEVED_EVIDENCE", INSUFFICIENT, List.of(), generated);
        return new Response(answer.status(), null, answer.claims().stream().map(Claim::text).collect(Collectors.joining("\n\n")),
            generated.evidence().stream().filter(citation -> citedIds.contains(citation.chunkId())).toList(), generated,
            generated.analysisEvidence().stream().filter(citation -> citedIds.contains(citation.evidenceId())).toList());
    }
    private static ModelFailure invalid() { return new ModelFailure(ApiErrorCode.AI_OUTPUT_INVALID); }
}
