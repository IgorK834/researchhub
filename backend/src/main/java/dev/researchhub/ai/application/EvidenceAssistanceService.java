package dev.researchhub.ai.application;

import dev.researchhub.ai.application.AuthoringContracts.*;
import dev.researchhub.ai.application.GenerationContracts.*;
import dev.researchhub.shared.error.*;
import dev.researchhub.source.application.SourceService;
import dev.researchhub.workspace.application.WorkspaceAuthorizationService;
import org.springframework.stereotype.Service;
import tools.jackson.databind.ObjectMapper;

import java.util.*;
import java.util.stream.Collectors;

/** Research assistance for a server-derived anchored claim, using the existing evidence model contract. */
@Service
public class EvidenceAssistanceService {
    public record Evidence(List<Candidate> candidates, List<String> warnings, AuthoringContracts.Result generation, ContextContracts.Summary context) {}
    private final WorkspaceAuthorizationService authorization;
    private final RetrievalSearchService search;
    private final SourceRetrievalService retrieval;
    private final SourceService sources;
    private final ModelGateway gateway;
    private final AuthoringFeature feature;
    private final GroundedContextBuilder contexts;
    private final ContextProperties budgets;
    private final ObjectMapper json;
    public EvidenceAssistanceService(WorkspaceAuthorizationService authorization, RetrievalSearchService search,
            SourceRetrievalService retrieval, SourceService sources, ModelGateway gateway, AuthoringFeature feature,
            GroundedContextBuilder contexts, ContextProperties budgets, ObjectMapper json) {
        this.authorization=authorization; this.search=search; this.retrieval=retrieval; this.sources=sources;
        this.gateway=gateway; this.feature=feature; this.contexts=contexts; this.budgets=budgets; this.json=json;
    }
    /** No transaction or document lock spans retrieval or inference. Client text is never accepted here. */
    public Evidence find(UUID workspace, UUID caller, String claim) {
        authorization.requireAiContributor(workspace, caller);
        if (claim == null || claim.isBlank() || claim.length() > 2000)
            throw new ApiException(ApiErrorCode.VALIDATION_FAILED, "Select 1–2000 characters of live text for research assistance");
        List<RetrievalHit> hits;
        try { hits=search.search(claim, workspace, null, 8, caller); }
        catch (EmbeddingFailure failure) { throw new ModelFailure(failure.retryable() ? ApiErrorCode.AI_UNAVAILABLE : ApiErrorCode.AI_PROVIDER_ERROR); }
        if (hits.size()>8 || hits.stream().anyMatch(h -> !workspace.equals(h.chunk().workspaceId()))
                || hits.stream().map(h -> h.chunk().chunkId()).distinct().count()!=hits.size()) throw invalid();
        var chunks=hits.stream().map(RetrievalHit::chunk).toList();
        var citations=chunks.stream().map(c -> Citation.from(c,sources.findOne(workspace,caller,c.sourceId()).displayName())).toList();
        AuthoringContracts.Result result=null; ContextContracts.Summary context=null; List<Candidate> candidates=List.of();
        if (!chunks.isEmpty()) {
            var policy=feature.policy(Kind.EVIDENCE);
            var fields=new LinkedHashMap<String,Object>();
            fields.put("kind", Kind.EVIDENCE); fields.put("selectedText",claim);
            fields.put("instruction","Find source evidence for this highlighted claim. Explain relevance; do not edit or resolve its comment.");
            fields.put("action",null); fields.put("surroundingContext",""); fields.put("lengthTarget",200);
            fields.put("stylePreset","ACADEMIC"); fields.put("citationRequired",true);
            String instruction=json.writeValueAsString(fields);
            if (instruction.codePointCount(0,instruction.length())>4000)
                throw new ApiException(ApiErrorCode.AI_CONTEXT_TOO_LARGE,"Shorten the highlighted claim for research assistance");
            var request=new Request("1.0",UUID.randomUUID(),policy.templateId(),policy.templateHash(),policy.systemInstruction(),
                    instruction,policy.parameters(),chunks.stream().map(c -> new GenerationContracts.Evidence(c.chunkId(),c.contentHash(),c.content())).toList());
            if (citations.stream().mapToInt(c -> c.spans().size()).sum()>1024) throw invalid();
            var contextual=contexts.build(request,citations,budgets.budget());
            result=gateway.author(workspace,caller,contextual,Kind.EVIDENCE,true); context=contextual.context().summary();
            var byId=citations.stream().collect(Collectors.toMap(Citation::chunkId,c -> c));
            var chunkById=chunks.stream().collect(Collectors.toMap(RetrievalChunk::chunkId,c -> c));
            candidates=result.answer().matches().stream().map(m -> new Candidate(byId.get(m.chunkId()),
                    chunkById.get(m.chunkId()).content().substring(0,Math.min(1500,chunkById.get(m.chunkId()).content().length())),
                    m.category(),m.relevance(),m.reason())).toList();
        }
        authorization.requireAiContributor(workspace,caller);
        for (var chunk:chunks) if (!chunk.equals(retrieval.chunk(workspace,chunk.sourceId(),caller,chunk.chunkId(),chunk.processingVersion())))
            throw new ConflictException("Source evidence has changed; request research assistance again");
        var warnings=new ArrayList<String>();
        if (result!=null && "deterministic".equals(result.model().provider())) warnings.add("Offline fixture: extracted text and lexical matching require human review.");
        if (candidates.stream().noneMatch(c -> c.category()!=Category.insufficient)) warnings.add("Insufficient evidence in the workspace sources.");
        return new Evidence(candidates,List.copyOf(warnings),result,context);
    }
    private static ModelFailure invalid() { return new ModelFailure(ApiErrorCode.AI_OUTPUT_INVALID); }
}
