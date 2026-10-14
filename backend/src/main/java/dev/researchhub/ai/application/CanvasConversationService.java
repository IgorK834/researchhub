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
    @org.springframework.beans.factory.annotation.Autowired private dev.researchhub.ai.observability.CanvasWorkflowObservation observation=dev.researchhub.ai.observability.CanvasWorkflowObservation.none();
    private final CanvasTurnStore turns;private final ConversationStore conversations;private final CanvasContextService contexts;
    private final CanvasContextStore snapshots;private final WorkspaceAuthorizationService access;private final DocumentService documents;
    private final SourceReadScope scope;private final SourceService sources;private final SourceRetrievalService retrieval;
    private final AnalysisEvidenceService analyses;private final CanvasFollowupContext memory;private final ModelGateway gateway;private final QuestionFeature policy;
    @org.springframework.beans.factory.annotation.Autowired private CanvasProposalService proposals;
    @org.springframework.beans.factory.annotation.Autowired private CanvasIntentRouter router;
    @org.springframework.beans.factory.annotation.Autowired private dev.researchhub.analysis.application.AnalysisService datasetAnalyses;
    @org.springframework.beans.factory.annotation.Autowired private dev.researchhub.analysis.application.ExecutionService datasetExecutions;
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
            var current=turns.find(work.workspaceId(),work.conversationId(),work.turnId());
            if(current.executionId()!=null) {
                var e=datasetExecutions.find(work.workspaceId(),work.callerId(),current.analysisId(),current.executionId());
                if(Set.of(dev.researchhub.analysis.application.ExecutionContracts.Status.QUEUED,dev.researchhub.analysis.application.ExecutionContracts.Status.RUNNING).contains(e.status()))turns.deferExecution(work);
                else {
                    if(e.diagnostics()!=null)observation.record(work,dev.researchhub.audit.application.ProductAudit.CanvasStage.SANDBOX,e.diagnostics().durationMillis(),e.status()==dev.researchhub.analysis.application.ExecutionContracts.Status.SUCCEEDED);
                    turns.finishExecution(work,e.status()==dev.researchhub.analysis.application.ExecutionContracts.Status.SUCCEEDED
                    ? "The selected immutable dataset was calculated in the isolated sandbox. Review its saved tables, charts and provenance."
                    : "The saved dataset execution failed ("+e.failureCode()+"). Open Analysis Studio to inspect the failure; no result was published.");
                }
                return;
            }
            var built=memory.build(work);String kind="ANSWER";QuestionContracts.Response response;
            var route=observation.measure(work,dev.researchhub.audit.application.ProductAudit.CanvasStage.ROUTING,()->router.route(work.request().intent(),built.clarification()));
            if(route instanceof CanvasIntentRouter.Clarify clarification) {kind="CLARIFICATION";response=clarify(clarification.message());}
            else if(route instanceof CanvasIntentRouter.Edit) {
                var proposal=proposals.generate(work,built.memory());
                authorize(work.workspaceId(),work.callerId(),work.request());
                contexts.resolve(work.workspaceId(),work.documentId(),work.callerId(),proposal==null ? work.request().contextId() : proposal.contextId());
                active(work.workspaceId(),documents.findOne(work.workspaceId(),work.callerId(),work.documentId()).summary().archivedAt());
                if(proposal!=null) {turns.proposal(work,proposal,memory.summary(built.memory()));return;}
                kind="CLARIFICATION";response=clarify("Select source evidence that supports the requested draft.");
            } else if(route instanceof CanvasIntentRouter.Dataset) {
                if(work.request().datasetInputs()!=null) {
                    if(work.request().datasetInputs().stream().anyMatch(i -> i.sheetName()==null || i.columns()==null || i.columns().isEmpty())) {
                        turns.complete(work,clarify("Choose the exact immutable version, sheet and columns before calculation."),"CLARIFICATION",memory.summary(built.memory()));return;
                    }
                    var id=turns.prepareDataset(work,work.request().datasetInputs(),memory.summary(built.memory()));
                    var a=datasetAnalyses.find(work.workspaceId(),work.callerId(),id);
                    if(a.plan()==null) {
                        if(!turns.beginModel(work))throw new ConflictException("Planning is no longer active");
                        observation.measure(work,dev.researchhub.audit.application.ProductAudit.CanvasStage.MODEL,()->datasetAnalyses.plan(work.workspaceId(),work.callerId(),id));
                    }
                    authorize(work.workspaceId(),work.callerId(),work.request());
                    turns.startDatasetExecution(work);return;
                }
                var ids=work.request().scope().sourceVersionIds();
                var inputs=new ArrayList<dev.researchhub.analysis.application.AnalysisContracts.Input>();
                for(var id:ids) {
                    var version=sources.versionById(work.workspaceId(),work.callerId(),id);
                    if(!Set.of("CSV","XLSX").contains(version.sourceType()))continue;
                    inputs.add(new dev.researchhub.analysis.application.AnalysisContracts.Input(version.sourceId(),id,null,null));
                }
                if(!inputs.isEmpty() && inputs.size()<=5 && inputs.size()==ids.size()) {turns.analysis(work,inputs,memory.summary(built.memory()));return;}
                kind="ANALYSIS_HANDOFF";response=clarify("Select a CSV or XLSX dataset, or open Analysis Studio to choose data, inspect a plan and run it.");
            } else if(route instanceof CanvasIntentRouter.Problem) {
                turns.problem(work,built.memory().selectedText()+"\n"+work.request().instruction(),memory.summary(built.memory()));return;
            } else {
                if(!work.request().scope().sourceVersionIds().isEmpty())turns.admitRetrieval(work);
                long retrievalStart=System.nanoTime();
                var selectedChunks=new ArrayList<RetrievalChunk>();
                for(var id:work.request().scope().sourceVersionIds()) {
                    var version=sources.versionById(work.workspaceId(),work.callerId(),id);
                    var set=retrieval.version(work.workspaceId(),version.sourceId(),id,work.callerId());
                    if(!work.workspaceId().equals(set.workspaceId()) || !id.equals(set.sourceVersionId()))throw new ResourceNotFoundException("Source version was not found");
                    // Deterministic bounded lexical ranking over explicit immutable versions; no global search.
                    selectedChunks.addAll(set.chunks().stream().sorted(Comparator.comparingInt((RetrievalChunk c)->score(c.content(),work.request().instruction(),built.memory().selectedText())).reversed().thenComparing(RetrievalChunk::chunkId)).limit(6).toList());
                }
                observation.record(work,dev.researchhub.audit.application.ProductAudit.CanvasStage.RETRIEVAL,dev.researchhub.ai.observability.CanvasWorkflowObservation.elapsed(retrievalStart),true);
                var boundedRefs= selectedChunks.stream().sorted(Comparator.comparingInt((RetrievalChunk c)->score(c.content(),work.request().instruction(),built.memory().selectedText())).reversed().thenComparing(RetrievalChunk::chunkId))
                    .limit(Math.min(policy.topK(),12-work.request().scope().analysisOutputs().size())).map(c->new EvidenceReference(c.sourceId(),c.chunkId(),c.processingVersion(),c.sourceVersionId())).toList();
                if(boundedRefs.isEmpty() && work.request().scope().analysisOutputs().isEmpty())response=new QuestionContracts.Response("INSUFFICIENT_EVIDENCE","NO_RETRIEVED_EVIDENCE",WorkspaceQuestionService.noEvidence(work.request().answerLanguage()),List.of(),null);
                else {
                    if(!turns.beginModel(work))throw new ConflictException("The turn is no longer active");
                    var generated=observation.measure(work,dev.researchhub.audit.application.ProductAudit.CanvasStage.MODEL,()->gateway.generate(work.workspaceId(),work.callerId(),new Command("Answer the user instruction in conversationContext using only the current S/A evidence.",boundedRefs),LocalizedGenerationPolicy.of(policy,work.request().answerLanguage()),work.request().scope().analysisOutputs(),built.memory()));
                    var answer=generated.result().answer();var ids=answer.claims().stream().flatMap(c->c.evidenceIds().stream()).collect(java.util.stream.Collectors.toSet());
                    response="INSUFFICIENT_EVIDENCE".equals(answer.status()) ? new QuestionContracts.Response(answer.status(),"INSUFFICIENT_RETRIEVED_EVIDENCE",WorkspaceQuestionService.insufficient(work.request().answerLanguage()),List.of(),generated)
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
