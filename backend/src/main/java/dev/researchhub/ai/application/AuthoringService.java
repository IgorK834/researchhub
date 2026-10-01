package dev.researchhub.ai.application;

import dev.researchhub.ai.application.AuthoringContracts.*;
import dev.researchhub.ai.application.GenerationContracts.*;
import dev.researchhub.document.application.*;
import dev.researchhub.source.application.*;
import dev.researchhub.shared.error.*;
import dev.researchhub.workspace.application.WorkspaceAuthorizationService;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.ObjectMapper;
import java.time.Clock;
import java.util.*;
import java.util.stream.Collectors;

/** Application orchestration only: authorized retrieval -> proposal -> explicit atomic approval. */
@Service
@Profile("local")
public class AuthoringService {
    private final DocumentService documents;
    private final WorkspaceAuthorizationService authorization;
    private final SourceReadScope scope;
    private final SourceService sources;
    private final RetrievalSearchService search;
    private final SourceRetrievalService retrieval;
    private final ModelGateway gateway;
    private final AuthoringFeature features;
    private final GroundedContextBuilder contexts;
    private final ContextProperties budgets;
    private final AuthoringStore store;
    private final ObjectMapper json;
    private final AuthoringDocument editing;
    private final Clock clock;
    public AuthoringService(DocumentService documents, WorkspaceAuthorizationService authorization, SourceReadScope scope,
        SourceService sources, RetrievalSearchService search, SourceRetrievalService retrieval, ModelGateway gateway,
        AuthoringFeature features, GroundedContextBuilder contexts, ContextProperties budgets, AuthoringStore store, ObjectMapper json, Clock clock) {
        this.documents=documents; this.authorization=authorization; this.scope=scope; this.sources=sources; this.search=search;
        this.retrieval=retrieval; this.gateway=gateway; this.features=features; this.contexts=contexts; this.budgets=budgets;
        this.store=store; this.json=json; this.editing=new AuthoringDocument(json); this.clock=clock;
    }
    // No document transaction/row lock is held across a remote inference call.
    public Suggestion suggest(UUID workspaceId, UUID documentId, UUID callerId, AuthoringContracts.Command command) {
        authorization.requireContentEditor(workspaceId,callerId);
        var document=documents.findOne(workspaceId,callerId,documentId);
        active(document); revision(document,command.expectedRevision());
        if (command.selectedSourceIds()!=null) scope.requireSources(workspaceId,callerId,command.selectedSourceIds());
        var fragment=command.kind()==Kind.DRAFT ? null : editing.fragment(document.content(),command.from(),command.to());
        String original=fragment==null ? "" : fragment.text();
        var fields=new LinkedHashMap<String,Object>();
        fields.put("kind",command.kind()); fields.put("instruction",command.instruction()); fields.put("action",command.action());
        fields.put("lengthTarget",command.lengthTarget()); fields.put("stylePreset",command.stylePreset()); fields.put("citationRequired",command.citationRequired());
        fields.put("selectedText",original);
        fields.put("surroundingContext",fragment==null ? editing.placementContext(document.content(),command.placementBlock()) : fragment.before()+"\n"+fragment.after());
        String query=command.kind()==Kind.DRAFT ? command.instruction() : original;
        List<RetrievalHit> hits;
        try { hits=search.search(query,workspaceId,command.selectedSourceIds(),8,callerId); }
        catch (EmbeddingFailure failure) { throw new ModelFailure(failure.retryable() ? ApiErrorCode.AI_UNAVAILABLE : ApiErrorCode.AI_PROVIDER_ERROR); }
        if (hits.size()>8 || hits.stream().anyMatch(h -> !workspaceId.equals(h.chunk().workspaceId())
                || command.selectedSourceIds()!=null && !command.selectedSourceIds().contains(h.chunk().sourceId()))
                || hits.stream().map(h -> h.chunk().chunkId()).distinct().count()!=hits.size()) throw invalid();
        var chunks=hits.stream().map(RetrievalHit::chunk).toList();
        var citations=chunks.stream().map(c -> Citation.from(c,sources.findOne(workspaceId,callerId,c.sourceId()).displayName())).toList();
        AuthoringContracts.Result result=null; ContextContracts.Summary context=null;
        String generated=""; List<Candidate> candidates=List.of(); List<Citation> cited=List.of();
        if (!chunks.isEmpty() || command.kind()==Kind.REWRITE && !command.citationRequired()) {
            var policy=features.policy(command.kind());
            var request=new Request("1.0",UUID.randomUUID(),policy.templateId(),policy.templateHash(),policy.systemInstruction(),
                json.writeValueAsString(fields),policy.parameters(),chunks.stream().map(c -> new Evidence(c.chunkId(),c.contentHash(),c.content())).toList());
            var contextual=contexts.build(request,citations,budgets.budget());
            if (citations.stream().mapToInt(c -> c.spans().size()).sum()>1024) throw invalid();
            result=gateway.author(workspaceId,callerId,contextual,command.kind(),command.citationRequired());
            context=contextual.context().summary(); generated=result.answer().text();
            var byId=citations.stream().collect(Collectors.toMap(Citation::chunkId,c -> c));
            var chunkById=chunks.stream().collect(Collectors.toMap(RetrievalChunk::chunkId,c -> c));
            cited=result.answer().citationIds().stream().map(byId::get).toList();
            candidates=result.answer().matches().stream().map(m -> new Candidate(byId.get(m.chunkId()),
                chunkById.get(m.chunkId()).content().substring(0,Math.min(1500,chunkById.get(m.chunkId()).content().length())),m.category(),m.relevance(),m.reason())).toList();
        }
        authorization.requireContentEditor(workspaceId,callerId);
        if (command.selectedSourceIds()!=null) scope.requireSources(workspaceId,callerId,command.selectedSourceIds());
        for (var c:chunks) if (!c.equals(retrieval.chunk(workspaceId,c.sourceId(),callerId,c.chunkId(),c.processingVersion())))
            throw new ConflictException("Source evidence has changed; generate a new suggestion");
        var latest=documents.findOne(workspaceId,callerId,documentId); active(latest); revision(latest,command.expectedRevision());
        var warnings=new ArrayList<>(fragment==null ? List.<String>of() : fragment.warnings());
        if (result!=null && "deterministic".equals(result.model().provider())) warnings.add("Offline fixture: extracted text and lexical matching require human review.");
        if (generated.isBlank() && candidates.stream().noneMatch(c -> c.category()!=Category.insufficient)) warnings.add("Insufficient evidence in the selected/retrieved sources.");
        return store.save(new Suggestion(UUID.randomUUID(),workspaceId,documentId,callerId,"PENDING",command,original,generated,cited,candidates,
            List.copyOf(warnings),result,context,clock.instant(),null));
    }
    public Suggestion find(UUID workspaceId, UUID documentId, UUID callerId, UUID id) {
        documents.findOne(workspaceId,callerId,documentId); return store.find(workspaceId,documentId,id,false);
    }
    @Transactional
    public Suggestion reject(UUID workspaceId, UUID documentId, UUID callerId, UUID id) {
        authorization.requireContentEditor(workspaceId,callerId); documents.findOne(workspaceId,callerId,documentId);
        var suggestion=store.find(workspaceId,documentId,id,true);
        if ("ACCEPTED".equals(suggestion.state())) throw new ConflictException("This suggestion was already accepted");
        store.reject(workspaceId,id); return store.find(workspaceId,documentId,id,false);
    }
    public record Acceptance(UUID eventId, long acceptedRevision, DocumentDetail document) {}
    @Transactional
    public Acceptance accept(UUID workspaceId, UUID documentId, UUID callerId, UUID id, Accept input) {
        authorization.requireContentEditor(workspaceId,callerId);
        var s=store.find(workspaceId,documentId,id,true);
        var document=documents.findOne(workspaceId,callerId,documentId);
        if ("ACCEPTED".equals(s.state())) {
            if (!json.readValue(store.acceptedInput(workspaceId,id),Accept.class).equals(input)) throw new ConflictException("This suggestion was accepted with different content");
            return new Acceptance(id,s.acceptedRevision(),document);
        }
        if (!"PENDING".equals(s.state())) throw new ConflictException("This suggestion was rejected");
        active(document); revision(document,input.expectedRevision());
        if (input.expectedRevision()!=s.command().expectedRevision()) throw new ConflictException("The document has changed; generate a new suggestion");
        var allSources=new HashSet<UUID>(); s.citations().forEach(c -> allSources.add(c.sourceId())); s.candidates().forEach(c -> allSources.add(c.citation().sourceId()));
        if (s.command().selectedSourceIds()!=null) allSources.addAll(s.command().selectedSourceIds());
        scope.requireSources(workspaceId,callerId,List.copyOf(allSources));
        String content;
        if (s.command().kind()==Kind.EVIDENCE) {
            if (input.editedText()!=null || input.citationChunkId()==null) throw validation();
            var candidate=s.candidates().stream().filter(c -> c.citation().chunkId().equals(input.citationChunkId()) && c.category()!=Category.insufficient)
                .findFirst().orElseThrow(AuthoringService::validation);
            content=editing.addCitation(document.content(),s.command().from(),s.command().to(),candidate.citation());
        } else {
            if (input.citationChunkId()!=null || s.generatedText().isBlank()) throw validation();
            String text=input.editedText()==null ? s.generatedText() : input.editedText();
            content=s.command().kind()==Kind.DRAFT ? editing.insertSection(document.content(),s.command().placementBlock(),text,s.citations())
                : editing.rewrite(document.content(),s.command().from(),s.command().to(),text,s.citations());
        }
        var saved=documents.reviseFromAi(workspaceId,callerId,documentId,new ReviseDocumentCommand(document.summary().title(),content,input.expectedRevision(),SaveKind.MANUAL));
        store.accept(workspaceId,id,callerId,saved.summary().revision(),input,RetrievalIdentity.hash(saved.content()));
        return new Acceptance(id,saved.summary().revision(),saved);
    }
    private static void revision(DocumentDetail doc,long expected) { DocumentService.requireCurrentRevision(doc,expected); }
    private static void active(DocumentDetail doc) { if (doc.summary().archivedAt()!=null) throw new ConflictException("The document is archived"); }
    private static ModelFailure invalid() { return new ModelFailure(ApiErrorCode.AI_OUTPUT_INVALID); }
    private static ApiException validation() { return new ApiException(ApiErrorCode.VALIDATION_FAILED,"This suggestion cannot be accepted with the supplied content or citation"); }
}
