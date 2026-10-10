package dev.researchhub.ai.application;

import dev.researchhub.ai.application.CanvasConversationContracts.*;
import dev.researchhub.ai.application.GenerationContracts.*;
import dev.researchhub.document.application.DocumentService;
import dev.researchhub.source.application.*;
import dev.researchhub.analysis.application.AnalysisEvidenceService;
import dev.researchhub.workspace.application.WorkspaceAuthorizationService;
import dev.researchhub.shared.error.*;
import org.springframework.stereotype.Service;
import java.util.*;

@Service
public class CanvasConversationService {
    private final CanvasTurnStore turns;private final ConversationStore conversations;private final CanvasContextService contexts;
    private final CanvasContextStore snapshots;private final WorkspaceAuthorizationService access;private final DocumentService documents;
    private final SourceReadScope scope;private final SourceService sources;private final SourceRetrievalService retrieval;
    private final AnalysisEvidenceService analyses;private final CanvasFollowupContext memory;private final ModelGateway gateway;private final QuestionFeature policy;
    public CanvasConversationService(CanvasTurnStore turns,ConversationStore conversations,CanvasContextService contexts,CanvasContextStore snapshots,
        WorkspaceAuthorizationService access,DocumentService documents,SourceReadScope scope,SourceService sources,SourceRetrievalService retrieval,
        AnalysisEvidenceService analyses,CanvasFollowupContext memory,ModelGateway gateway,QuestionFeature policy) {
        this.turns=turns;this.conversations=conversations;this.contexts=contexts;this.snapshots=snapshots;this.access=access;this.documents=documents;
        this.scope=scope;this.sources=sources;this.retrieval=retrieval;this.analyses=analyses;this.memory=memory;this.gateway=gateway;this.policy=policy;
    }
    public TurnState first(UUID workspace,UUID caller,FirstTurn request) {
        authorize(workspace,caller,request.turn());
        var context=snapshots.findById(workspace,request.contextId()).orElseThrow(()->new ResourceNotFoundException("Document context was not found")).context();
        contexts.find(workspace,context.documentId(),caller,context.contextId());
        var document=documents.findOne(workspace,caller,context.documentId());
        active(workspace,document.summary().archivedAt());
        return turns.first(workspace,caller,request,new Origin(context.documentId(),context.contextId(),document.summary().title()));
    }
    public TurnState send(UUID workspace,UUID caller,UUID conversation,Turn request) {
        authorize(workspace,caller,request);
        var origin=conversations.find(workspace,conversation).origin();
        if(origin==null)throw new ConflictException("This conversation uses the legacy question contract");
        contexts.find(workspace,origin.documentId(),caller,request.contextId());
        active(workspace,documents.findOne(workspace,caller,origin.documentId()).summary().archivedAt());
        return turns.reserve(workspace,caller,conversation,request);
    }
    public TurnState find(UUID workspace,UUID caller,UUID conversation,UUID turn) {
        access.requireContentReader(workspace,caller);
        var origin=conversations.find(workspace,conversation).origin();
        if(origin==null)throw new ResourceNotFoundException("Contextual conversation was not found");
        var state=turns.find(workspace,conversation,turn);contexts.find(workspace,origin.documentId(),caller,state.contextId());
        authorizeScope(workspace,caller,state.scope());return state;
    }
    public TurnState cancel(UUID workspace,UUID caller,UUID conversation,UUID turn) {
        find(workspace,caller,conversation,turn);
        return turns.cancel(workspace,caller,conversation,turn);
    }
    public void execute(Work work) {
        try {
            authorize(work.workspaceId(),work.callerId(),work.request());
            var built=memory.build(work);String kind="ANSWER";QuestionContracts.Response response;
            if(built.clarification()!=null) {kind="CLARIFICATION";response=clarify(built.clarification());}
            else if(!Set.of(Intent.ANSWER,Intent.CLARIFY).contains(work.request().intent())) {
                kind="CLARIFICATION";response=clarify("This chat currently answers and explains saved evidence. Document proposals and new calculations require the authoring or analysis tools.");
            } else {
                var selectedChunks=new ArrayList<RetrievalChunk>();
                for(var id:work.request().scope().sourceVersionIds()) {
                    var version=sources.versionById(work.workspaceId(),work.callerId(),id);
                    var set=retrieval.version(work.workspaceId(),version.sourceId(),id,work.callerId());
                    if(!work.workspaceId().equals(set.workspaceId()) || !id.equals(set.sourceVersionId()))throw new ResourceNotFoundException("Source version was not found");
                    // Deterministic bounded lexical ranking over explicit immutable versions; no global search.
                    selectedChunks.addAll(set.chunks().stream().sorted(Comparator.comparingInt((RetrievalChunk c)->score(c.content(),work.request().instruction(),built.memory().selectedText())).reversed().thenComparing(RetrievalChunk::chunkId)).limit(6).toList());
                }
                var boundedRefs= selectedChunks.stream().sorted(Comparator.comparingInt((RetrievalChunk c)->score(c.content(),work.request().instruction(),built.memory().selectedText())).reversed().thenComparing(RetrievalChunk::chunkId))
                    .limit(Math.min(policy.topK(),12-work.request().scope().analysisOutputs().size())).map(c->new EvidenceReference(c.sourceId(),c.chunkId(),c.processingVersion(),c.sourceVersionId())).toList();
                if(boundedRefs.isEmpty() && work.request().scope().analysisOutputs().isEmpty())response=new QuestionContracts.Response("INSUFFICIENT_EVIDENCE","NO_RETRIEVED_EVIDENCE",WorkspaceQuestionService.NO_EVIDENCE,List.of(),null);
                else {
                    var generated=gateway.generate(work.workspaceId(),work.callerId(),new Command("Answer the user instruction in conversationContext using only the current S/A evidence.",boundedRefs),policy,work.request().scope().analysisOutputs(),built.memory());
                    var answer=generated.result().answer();var ids=answer.claims().stream().flatMap(c->c.evidenceIds().stream()).collect(java.util.stream.Collectors.toSet());
                    response="INSUFFICIENT_EVIDENCE".equals(answer.status()) ? new QuestionContracts.Response(answer.status(),"INSUFFICIENT_RETRIEVED_EVIDENCE",WorkspaceQuestionService.INSUFFICIENT,List.of(),generated)
                        : new QuestionContracts.Response(answer.status(),null,answer.claims().stream().map(Claim::text).collect(java.util.stream.Collectors.joining("\n\n")),generated.evidence().stream().filter(c->ids.contains(c.chunkId())).toList(),generated,generated.analysisEvidence().stream().filter(c->ids.contains(c.evidenceId())).toList());
                }
            }
            authorize(work.workspaceId(),work.callerId(),work.request());
            contexts.find(work.workspaceId(),work.documentId(),work.callerId(),work.request().contextId());
            active(work.workspaceId(),documents.findOne(work.workspaceId(),work.callerId(),work.documentId()).summary().archivedAt());
            turns.complete(work,response,kind,memory.summary(built.memory()));
        } catch(ApiException safe) {turns.fail(work,safe.code());}
        catch(RuntimeException unsafe) {turns.fail(work,ApiErrorCode.INTERNAL_ERROR);}
    }
    private void authorize(UUID workspace,UUID caller,Turn turn) {
        access.requireContentReader(workspace,caller);
        if(Set.of(Intent.EDIT,Intent.ANALYZE,Intent.SOLVE).contains(turn.intent()))access.requireContentEditor(workspace,caller);
        authorizeScope(workspace,caller,turn.scope());
    }
    private void authorizeScope(UUID workspace,UUID caller,Scope value) {
        scope.requireSourceVersions(workspace,caller,value.sourceVersionIds());analyses.resolve(workspace,caller,value.analysisOutputs());
    }
    private void active(UUID workspace,java.time.Instant archived) {if(archived!=null || !access.permitsSystemContentMaintenance(workspace))throw new ConflictException("New turns require an active workspace and document");}
    private static QuestionContracts.Response clarify(String text) {return new QuestionContracts.Response("INSUFFICIENT_EVIDENCE","INSUFFICIENT_RETRIEVED_EVIDENCE",text,List.of(),null);}
    private static int score(String content,String instruction,String selected) {
        String text=content.toLowerCase(Locale.ROOT);return (int)Arrays.stream((instruction+" "+selected).toLowerCase(Locale.ROOT).split("\\W+"))
            .filter(w->w.length()>2).distinct().filter(text::contains).count();
    }
}
