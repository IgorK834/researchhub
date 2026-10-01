package dev.researchhub.ai.application;

import dev.researchhub.ai.application.GenerationContracts.*;
import dev.researchhub.shared.error.*;
import dev.researchhub.workspace.application.WorkspaceAuthorizationService;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Service;
import java.util.*;

/** All product generation calls share authorization, evidence validation and bounded audit persistence. */
@Service
@Profile("local")
public class ModelGateway {
    private final ModelProvider provider;
    private final AuthoringModelProvider authoringProvider;
    private final SourceAnalysisModelProvider analysisProvider;
    private final SourceRetrievalService retrieval;
    private final WorkspaceAuthorizationService authorization;
    private final GenerationFeature feature;
    private final GenerationStore store;
    private final GroundedContextBuilder contexts;
    private final ContextProperties contextProperties;
    private final dev.researchhub.source.application.SourceService sources;
    public ModelGateway(ModelProvider provider, SourceRetrievalService retrieval, WorkspaceAuthorizationService authorization,
                        GenerationFeature feature, GenerationStore store, GroundedContextBuilder contexts, ContextProperties contextProperties,
                        dev.researchhub.source.application.SourceService sources, AuthoringModelProvider authoringProvider,
                        SourceAnalysisModelProvider analysisProvider) {
        this.analysisProvider = analysisProvider;
        this.authoringProvider = authoringProvider;
        this.provider = provider; this.retrieval = retrieval; this.authorization = authorization; this.feature = feature; this.store = store;
        this.contexts = contexts; this.contextProperties = contextProperties; this.sources = sources;
    }
    public GeneratedResponse generate(UUID workspaceId, UUID callerId, Command command) {
        return generate(workspaceId, callerId, command, feature);
    }
    GeneratedResponse generate(UUID workspaceId, UUID callerId, Command command, GenerationPolicy policy) {
        authorization.requireContentReader(workspaceId, callerId);
        var chunks = resolve(workspaceId, callerId, command);
        var request = new Request("1.0", UUID.randomUUID(), policy.templateId(), policy.templateHash(), policy.systemInstruction(),
            command.instruction(), policy.parameters(), chunks.stream().map(c -> new Evidence(c.chunkId(), c.contentHash(), c.content())).toList());
        var titles = new HashMap<UUID, String>();
        chunks.forEach(c -> titles.computeIfAbsent(c.sourceId(), id -> sources.findOne(workspaceId, callerId, id).displayName()));
        var citations = chunks.stream().map(c -> Citation.from(c, titles.get(c.sourceId()))).toList();
        if (citations.stream().mapToInt(c -> c.spans().size()).sum() > 1024)
            throw new ApiException(ApiErrorCode.VALIDATION_FAILED, "Selected evidence exceeds the provenance limit; select fewer chunks");
        var contextual = contexts.build(request, citations, contextProperties.budget());
        store.begin(workspaceId, callerId, contextual, citations);
        try {
            Result result;
            try { result = provider.generateStructured(contextual); }
            catch (ModelFailure safe) { throw safe; }
            catch (RuntimeException unsafe) { throw new ModelFailure(ApiErrorCode.AI_PROVIDER_ERROR); }
            try { Objects.requireNonNull(result).validateFor(request); }
            catch (IllegalArgumentException | NullPointerException invalid) { throw new ModelFailure(ApiErrorCode.AI_OUTPUT_INVALID); }
            // A source may have been reprocessed/deleted or membership revoked during a remote model call.
            authorization.requireContentReader(workspaceId, callerId);
            if (!chunks.equals(resolve(workspaceId, callerId, command))) throw new ConflictException("Source evidence has changed; refresh its chunks");
            var response = new GeneratedResponse(result, citations, contextual.context().summary());
            store.succeed(workspaceId, response);
            return response;
        } catch (ApiException failure) {
            store.fail(workspaceId, request.requestId(), failure.code());
            throw failure;
        }
    }
    /** Authoring has a separate result schema; it shares the model boundary and fail-closed validation.
     * The authoring application persists the result/context with its approval state. */
    AuthoringContracts.Result author(UUID workspaceId, UUID callerId, ContextContracts.ContextualRequest request,
                                    AuthoringContracts.Kind kind, boolean citationRequired) {
        authorization.requireContentReader(workspaceId, callerId);
        AuthoringContracts.Result result;
        try { result = authoringProvider.author(request); }
        catch (ModelFailure safe) { throw safe; }
        catch (RuntimeException unsafe) { throw new ModelFailure(ApiErrorCode.AI_PROVIDER_ERROR); }
        try { Objects.requireNonNull(result).validateFor(request.request(), kind, citationRequired); }
        catch (IllegalArgumentException | NullPointerException invalid) { throw new ModelFailure(ApiErrorCode.AI_OUTPUT_INVALID); }
        authorization.requireContentReader(workspaceId, callerId);
        return result;
    }
    SourceAnalysisContracts.Result analyze(UUID workspaceId, UUID callerId, ContextContracts.ContextualRequest request,
        SourceAnalysisContracts.Kind kind, List<UUID> sourceIds, List<String> criteria, Map<String,UUID> evidence) {
        authorization.requireContentReader(workspaceId, callerId);
        SourceAnalysisContracts.Result result;
        try { result = analysisProvider.analyze(request); }
        catch (ModelFailure safe) { throw safe; }
        catch (RuntimeException unsafe) { throw new ModelFailure(ApiErrorCode.AI_PROVIDER_ERROR); }
        try { Objects.requireNonNull(result).validateFor(request.request(),kind,sourceIds,criteria,evidence); }
        catch (IllegalArgumentException | NullPointerException invalid) { throw new ModelFailure(ApiErrorCode.AI_OUTPUT_INVALID); }
        authorization.requireContentReader(workspaceId, callerId);
        return result;
    }
    private List<RetrievalChunk> resolve(UUID workspaceId, UUID callerId, Command command) {
        return command.evidence().stream().map(ref -> retrieval.chunk(workspaceId, ref.sourceId(), callerId, ref.chunkId(), ref.processingVersion())).toList();
    }
    public ModelMetadata modelMetadata(UUID workspaceId, UUID callerId) {
        authorization.requireContentReader(workspaceId, callerId);
        try { return Objects.requireNonNull(provider.modelMetadata()); }
        catch (ModelFailure safe) { throw safe; }
        catch (RuntimeException unsafe) { throw new ModelFailure(ApiErrorCode.AI_PROVIDER_ERROR); }
    }
    public GeneratedResponse find(UUID workspaceId, UUID callerId, UUID requestId) {
        authorization.requireContentReader(workspaceId, callerId);
        return store.findCompleted(workspaceId, requestId).orElseThrow(() -> new ResourceNotFoundException("The requested AI response was not found"));
    }
}
