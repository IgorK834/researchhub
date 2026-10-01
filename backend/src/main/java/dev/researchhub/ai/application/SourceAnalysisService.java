package dev.researchhub.ai.application;

import dev.researchhub.ai.application.SourceAnalysisContracts.*;
import dev.researchhub.ai.application.GenerationContracts.Citation;
import dev.researchhub.ai.application.GenerationContracts.Evidence;
import dev.researchhub.ai.application.GenerationContracts.Request;
import dev.researchhub.source.application.SourceReadScope;
import dev.researchhub.source.application.SourceService;
import dev.researchhub.workspace.application.WorkspaceAuthorizationService;
import dev.researchhub.shared.error.*;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Service;
import tools.jackson.databind.ObjectMapper;
import java.time.Clock;
import java.util.*;
import java.util.stream.Collectors;

/** Read-only, persisted AI interpretations. No document write is available in this workflow. */
@Service
@Profile("local")
public class SourceAnalysisService {
    private final WorkspaceAuthorizationService authorization;
    private final SourceReadScope scope;
    private final SourceService sources;
    private final RetrievalSearchService search;
    private final SourceRetrievalService retrieval;
    private final ModelGateway gateway;
    private final SourceAnalysisFeature feature;
    private final GroundedContextBuilder contexts;
    private final SourceAnalysisStore store;
    private final ObjectMapper json;
    private final Clock clock;
    public SourceAnalysisService(WorkspaceAuthorizationService authorization, SourceReadScope scope, SourceService sources,
        RetrievalSearchService search, SourceRetrievalService retrieval, ModelGateway gateway, SourceAnalysisFeature feature,
        GroundedContextBuilder contexts, SourceAnalysisStore store, ObjectMapper json, Clock clock) {
        this.authorization=authorization; this.scope=scope; this.sources=sources; this.search=search; this.retrieval=retrieval;
        this.gateway=gateway; this.feature=feature; this.contexts=contexts; this.store=store; this.json=json; this.clock=clock;
    }
    public Analysis compare(UUID workspace, UUID caller, Compare command) {
        authorize(workspace,caller,command);
        var descriptors=descriptors(workspace,caller,command.selectedSourceIds());
        var chunks=search(workspace,caller,command);
        requireVersions(chunks,descriptors);
        return generate(workspace,caller,Kind.COMPARISON,null,command,command.instruction(),chunks,descriptors,true);
    }
    private ArrayList<RetrievalChunk> search(UUID workspace, UUID caller, Compare command) {
        var chunks=new ArrayList<RetrievalChunk>();
        for (var source : command.selectedSourceIds()) {
            List<RetrievalHit> hits;
            try { hits=search.search(command.instruction()+"\n"+String.join(", ",command.criteria()),workspace,List.of(source),2,caller); }
            catch (EmbeddingFailure failure) { throw new ModelFailure(failure.retryable() ? ApiErrorCode.AI_UNAVAILABLE : ApiErrorCode.AI_PROVIDER_ERROR); }
            if (hits.size()>2 || hits.stream().anyMatch(h -> !workspace.equals(h.chunk().workspaceId()) || !source.equals(h.chunk().sourceId()))) throw invalid();
            chunks.addAll(hits.stream().map(RetrievalHit::chunk).toList());
        }
        if (chunks.stream().map(RetrievalChunk::chunkId).distinct().count()!=chunks.size()) throw invalid();
        return chunks;
    }
    public Analysis disagreements(UUID workspace, UUID caller, UUID comparisonId, FollowUp followUp) {
        var comparison=find(workspace,caller,comparisonId);
        if (comparison.kind()!=Kind.COMPARISON) throw new ApiException(ApiErrorCode.VALIDATION_FAILED,"Select a source comparison as the analysis baseline");
        List<Source> descriptors;
        List<RetrievalChunk> chunks;
        boolean requireActive;
        if (followUp.versionSelection()==VersionSelection.LATEST) {
            descriptors=descriptors(workspace,caller,comparison.command().selectedSourceIds());
            chunks=search(workspace,caller,comparison.command());
            requireVersions(chunks,descriptors);
            requireActive=true;
        } else {
            descriptors=comparison.sources();
            chunks=comparison.evidence().stream().map(c -> retrieval.chunk(workspace,c.sourceId(),c.sourceVersionId(),
                    caller,c.chunkId(),c.processingVersion())).toList();
            for (int i=0; i<chunks.size(); i++) {
                if (!comparison.evidence().get(i).equals(Citation.from(chunks.get(i),comparison.evidence().get(i).title())))
                    throw new ConflictException("Source evidence changed; create a new comparison");
            }
            requireActive=false;
        }
        return generate(workspace,caller,Kind.DISAGREEMENTS,comparisonId,comparison.command(),followUp.instruction(),
                chunks,descriptors,requireActive);
    }
    public Analysis find(UUID workspace, UUID caller, UUID id) {
        authorization.requireContentReader(workspace,caller);
        var result=store.find(workspace,id);
        var versionIds=result.sources().stream().map(Source::sourceVersionId).filter(Objects::nonNull).toList();
        if (versionIds.size()==result.sources().size()) scope.requireSourceVersions(workspace,caller,versionIds);
        else scope.requireSources(workspace,caller,result.command().selectedSourceIds());
        return result;
    }
    private Analysis generate(UUID workspace, UUID caller, Kind kind, UUID parent, Compare command, String instruction,
                              List<RetrievalChunk> chunks, List<Source> descriptors, boolean requireActive) {
        var titles=descriptors.stream().collect(Collectors.toMap(Source::id,Source::title));
        var citations=chunks.stream().map(c -> Citation.from(c,titles.get(c.sourceId()))).toList();
        if (citations.stream().mapToInt(c -> c.spans().size()).sum()>1024) throw invalid();
        var evidence=chunks.stream().collect(Collectors.toMap(RetrievalChunk::chunkId,RetrievalChunk::sourceId));
        Result result=null; ContextContracts.Summary context=null; Answer answer;
        if (chunks.isEmpty() || kind==Kind.DISAGREEMENTS && new HashSet<>(evidence.values()).size()<2) {
            answer=new Answer("INSUFFICIENT_EVIDENCE",kind==Kind.COMPARISON ? command.selectedSourceIds().stream()
                .map(id -> new Row(id,command.criteria().stream().map(c -> new Cell(c,"MISSING",null,List.of())).toList())).toList() : List.of(),List.of(),List.of());
        } else {
            var fields=new LinkedHashMap<String,Object>();
            fields.put("kind",kind); fields.put("selectedSourceIds",command.selectedSourceIds()); fields.put("criteria",command.criteria());
            fields.put("instruction",instruction); fields.put("parentComparisonId",parent);
            var policy=feature.policy(kind);
            var request=new Request("1.0",UUID.randomUUID(),policy.templateId(),policy.templateHash(),policy.systemInstruction(),json.writeValueAsString(fields),
                policy.parameters(),chunks.stream().map(c -> new Evidence(c.chunkId(),c.contentHash(),c.content())).toList());
            var contextual=contexts.build(request,citations,feature.budget());
            result=gateway.analyze(workspace,caller,contextual,kind,command.selectedSourceIds(),command.criteria(),evidence);
            answer=result.answer(); context=contextual.context().summary();
        }
        answer.validateFor(kind,command.selectedSourceIds(),command.criteria(),evidence);
        authorization.requireContentReader(workspace,caller);
        scope.requireSourceVersions(workspace,caller,descriptors.stream().map(Source::sourceVersionId).toList());
        if (requireActive) requireCurrentDescriptors(workspace,caller,descriptors);
        for (var c:chunks) if (!c.equals(retrieval.chunk(workspace,c.sourceId(),c.sourceVersionId(),caller,c.chunkId(),c.processingVersion())))
            throw new ConflictException("Source evidence changed; create a new comparison");
        var warnings=new ArrayList<String>();
        warnings.add("AI-assisted interpretation of retrieved excerpts; review the original sources and experimental conditions.");
        if (result!=null && "deterministic".equals(result.model().provider())) warnings.add("Offline fixture: only explicitly labelled research fields are extracted; this is not a model assessment.");
        if ("INSUFFICIENT_EVIDENCE".equals(answer.status())) warnings.add("Insufficient evidence; missing information was not inferred.");
        return store.save(new Analysis(UUID.randomUUID(),workspace,caller,kind,parent,command,instruction,descriptors,answer,citations,List.copyOf(warnings),result,context,clock.instant()));
    }
    private List<Source> descriptors(UUID workspace, UUID caller, List<UUID> sourceIds) {
        return sourceIds.stream().map(id -> {
            var source=sources.findOne(workspace,caller,id);
            var version=sources.activeVersion(workspace,caller,id);
            return new Source(id,source.displayName(),version.id(),version.versionNumber(),version.contentSha256());
        }).toList();
    }
    private void requireCurrentDescriptors(UUID workspace, UUID caller, List<Source> descriptors) {
        for (var descriptor:descriptors) {
            var current=sources.activeVersion(workspace,caller,descriptor.id());
            if (!current.id().equals(descriptor.sourceVersionId())
                    || !current.contentSha256().equals(descriptor.contentSha256())) {
                throw new ConflictException("A selected source was replaced; retry with the latest version");
            }
        }
    }
    private static void requireVersions(List<RetrievalChunk> chunks, List<Source> descriptors) {
        var versions=descriptors.stream().collect(Collectors.toMap(Source::id,Source::sourceVersionId));
        if (chunks.stream().anyMatch(chunk -> !Objects.equals(chunk.sourceVersionId(),versions.get(chunk.sourceId())))) {
            throw new ConflictException("Source evidence does not belong to the selected source version");
        }
    }
    private void authorize(UUID workspace, UUID caller, Compare command) {
        authorization.requireContentReader(workspace,caller); scope.requireSources(workspace,caller,command.selectedSourceIds());
    }
    private static ModelFailure invalid() { return new ModelFailure(ApiErrorCode.AI_OUTPUT_INVALID); }
}
