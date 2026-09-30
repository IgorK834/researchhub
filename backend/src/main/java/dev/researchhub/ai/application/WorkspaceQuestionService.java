package dev.researchhub.ai.application;

import dev.researchhub.ai.application.GenerationContracts.*;
import dev.researchhub.ai.application.QuestionContracts.*;
import dev.researchhub.shared.error.ApiErrorCode;
import dev.researchhub.workspace.application.WorkspaceAuthorizationService;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Service;
import java.util.*;
import java.util.stream.Collectors;

/** Question -> scoped retrieval -> the shared grounded gateway. No vendor/storage access here. */
@Service
@Profile("local")
public class WorkspaceQuestionService {
    public static final String NO_EVIDENCE = "No searchable evidence was found in the authorized sources for this question.";
    public static final String INSUFFICIENT = "The retrieved sources do not contain enough evidence to answer this question.";
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
        // Search validates every selected source before embedding; workspace/source filters are in SQL.
        List<RetrievalHit> hits;
        try { hits = retrieval.search(question.question(), workspaceId, question.selectedSourceIds(), feature.topK(), callerId); }
        catch (EmbeddingFailure failure) { throw new ModelFailure(failure.retryable() ? ApiErrorCode.AI_UNAVAILABLE : ApiErrorCode.AI_PROVIDER_ERROR); }
        execution.checkpoint();
        authorization.requireContentReader(workspaceId,callerId);
        execution.retrievalCompleted(hits.size());
        if (hits.isEmpty()) {
            authorization.requireContentReader(workspaceId, callerId);
            return new Response("INSUFFICIENT_EVIDENCE", "NO_RETRIEVED_EVIDENCE", NO_EVIDENCE, List.of(), null);
        }
        // Fail closed if an adapter violates its scope. This does not filter global search results.
        if (hits.size() > feature.topK() || hits.stream().anyMatch(hit -> !workspaceId.equals(hit.chunk().workspaceId())
                || question.selectedSourceIds() != null && !question.selectedSourceIds().contains(hit.chunk().sourceId()))
                || hits.stream().map(hit -> hit.chunk().chunkId()).distinct().count() != hits.size()) throw invalid();
        var references = hits.stream().map(hit -> new EvidenceReference(hit.chunk().sourceId(), hit.chunk().chunkId(), hit.chunk().processingVersion())).toList();
        var generated = gateway.generate(workspaceId, callerId, new Command(question.question(), references), feature);
        execution.checkpoint();
        var chunks = hits.stream().collect(Collectors.toMap(hit -> hit.chunk().chunkId(), RetrievalHit::chunk));
        if (generated.evidence().size() != chunks.size() || generated.evidence().stream().anyMatch(citation -> {
            var chunk = chunks.get(citation.chunkId());
            return chunk == null || !Citation.from(chunk, citation.title()).equals(citation);
        })) throw invalid();
        var answer = generated.result().answer();
        var citedIds = answer.claims().stream().flatMap(claim -> claim.evidenceIds().stream()).collect(Collectors.toSet());
        if (!chunks.keySet().containsAll(citedIds)) throw invalid();
        if ("INSUFFICIENT_EVIDENCE".equals(answer.status()))
            return new Response(answer.status(), "INSUFFICIENT_RETRIEVED_EVIDENCE", INSUFFICIENT, List.of(), generated);
        return new Response(answer.status(), null, answer.claims().stream().map(Claim::text).collect(Collectors.joining("\n\n")),
            generated.evidence().stream().filter(citation -> citedIds.contains(citation.chunkId())).toList(), generated);
    }
    private static ModelFailure invalid() { return new ModelFailure(ApiErrorCode.AI_OUTPUT_INVALID); }
}
