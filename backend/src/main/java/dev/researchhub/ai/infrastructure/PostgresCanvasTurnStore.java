package dev.researchhub.ai.infrastructure;

import dev.researchhub.ai.application.*;
import dev.researchhub.ai.application.CanvasConversationContracts.*;
import dev.researchhub.ai.application.ConversationContracts.*;
import dev.researchhub.shared.error.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.ObjectMapper;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.*;

@Repository
public class PostgresCanvasTurnStore implements CanvasTurnStore {
    private final dev.researchhub.security.application.CostQuotaStore quotas;
    private final dev.researchhub.security.application.QuotaPolicy quota;
    @org.springframework.beans.factory.annotation.Autowired private dev.researchhub.ai.observability.CanvasWorkflowObservation observation=dev.researchhub.ai.observability.CanvasWorkflowObservation.none();
    private final JdbcTemplate jdbc;private final ObjectMapper json;private final ConversationStore conversations;
    @org.springframework.beans.factory.annotation.Autowired private dev.researchhub.document.application.DocumentService documents;
    @org.springframework.beans.factory.annotation.Autowired private CanvasContextService contexts;
    @org.springframework.beans.factory.annotation.Autowired private dev.researchhub.source.application.SourceReadScope sources;
    @org.springframework.beans.factory.annotation.Autowired private dev.researchhub.analysis.application.AnalysisService analyses;
    @org.springframework.beans.factory.annotation.Autowired private dev.researchhub.analysis.application.ProblemService problems;
    @org.springframework.beans.factory.annotation.Autowired private dev.researchhub.analysis.application.ExecutionService executions;
    @org.springframework.beans.factory.annotation.Value("${researchhub.security.quotas.analysis.user:10}") private int analysisUser=10;
    @org.springframework.beans.factory.annotation.Value("${researchhub.security.quotas.analysis.workspace:30}") private int analysisWorkspace=30;
    public PostgresCanvasTurnStore(JdbcTemplate jdbc,ObjectMapper json,ConversationStore conversations,dev.researchhub.security.application.CostQuotaStore quotas,
        @org.springframework.beans.factory.annotation.Value("${researchhub.security.quotas.llm.user:20}") int userLimit,
        @org.springframework.beans.factory.annotation.Value("${researchhub.security.quotas.llm.workspace:60}") int workspaceLimit,
        @org.springframework.beans.factory.annotation.Value("${researchhub.security.quotas.window:PT1M}") java.time.Duration window) {
        this.jdbc=jdbc;this.json=json;this.conversations=conversations;this.quotas=quotas;this.quota=new dev.researchhub.security.application.QuotaPolicy(userLimit,workspaceLimit,window);
    }
    private String hash(Object value) {return RetrievalIdentity.hash(json.writeValueAsString(value));}
    private TurnState state(ResultSet r) throws SQLException {
        var request=json.readValue(r.getString("request"),Turn.class);
        String memory=r.getString("memory_summary"),failure=r.getString("failure_code");
        return new TurnState("1.0",r.getObject("id",UUID.class),r.getObject("conversation_id",UUID.class),r.getString("status"),
            r.getObject("message_id",UUID.class),r.getObject("canvas_proposal_id",UUID.class)==null ? r.getObject("proposal_id",UUID.class) : r.getObject("canvas_proposal_id",UUID.class),r.getObject("execution_id",UUID.class),
            failure==null ? null : ApiErrorCode.valueOf(failure),request.contextId(),request.intent(),request.scope(),r.getString("result_kind"),
            memory==null ? null : json.readValue(memory,MemorySummary.class),r.getObject("analysis_id",UUID.class),
            jdbc.queryForList("SELECT id FROM canvas_proposals WHERE workspace_id=? AND turn_id=? AND jsonb_exists(payload,'calculation') ORDER BY id",UUID.class,r.getObject("workspace_id",UUID.class),r.getObject("id",UUID.class)));
    }
    @Override @Transactional public TurnState first(UUID workspace,UUID caller,FirstTurn request,Origin origin) {
        // A unique index handles concurrent first requests across backend replicas.
        UUID id=UUID.randomUUID();
        jdbc.update("""
          INSERT INTO ai_conversations(id,workspace_id,created_by,title,origin,client_conversation_id,first_request_hash,origin_document_id,origin_context_id)
          VALUES(?,?,?,?,?::jsonb,?,?,?,?) ON CONFLICT DO NOTHING
          """,id,workspace,caller,head(request.turn().instruction(),80),json.writeValueAsString(origin),request.clientConversationId(),hash(request),origin.documentId(),origin.contextId());
        var row=jdbc.queryForMap("SELECT id,first_request_hash FROM ai_conversations WHERE workspace_id=? AND created_by=? AND client_conversation_id=? FOR UPDATE",workspace,caller,request.clientConversationId());
        if(!hash(request).equals(row.get("first_request_hash")))throw new ConflictException("Conversation identity was reused with a different payload");
        return reserve(workspace,caller,(UUID)row.get("id"),request.turn());
    }
    @Override @Transactional public TurnState reserve(UUID workspace,UUID caller,UUID conversation,Turn request) {
        jdbc.queryForList("SELECT id FROM ai_conversations WHERE workspace_id=? AND id=? FOR UPDATE",workspace,conversation).stream().findFirst().orElseThrow(PostgresCanvasTurnStore::missing);
        var existing=jdbc.query("SELECT * FROM canvas_turns WHERE workspace_id=? AND conversation_id=? AND client_request_id=?",(r,i)->Map.entry(r.getString("request_hash"),state(r)),workspace,conversation,request.clientRequestId());
        if(!existing.isEmpty()) {
            if(!hash(request).equals(existing.getFirst().getKey()))throw new ConflictException("Turn identity was reused with a different payload");
            return existing.getFirst().getValue();
        }
        if(Boolean.TRUE.equals(jdbc.queryForObject("SELECT EXISTS(SELECT 1 FROM canvas_turns WHERE workspace_id=? AND conversation_id=? AND status IN ('ACCEPTED','PLANNING','EXECUTING'))",Boolean.class,workspace,conversation)))
            throw new ConflictException("Wait for the current turn before sending another question");

        UUID turn=UUID.randomUUID(),user=UUID.randomUUID(),attempt=UUID.randomUUID();
        long sequence=Objects.requireNonNull(jdbc.queryForObject("UPDATE ai_conversations SET next_sequence=next_sequence+2,updated_at=now() WHERE workspace_id=? AND id=? RETURNING next_sequence-2",Long.class,workspace,conversation));
        jdbc.update("""
          INSERT INTO ai_messages(id,workspace_id,conversation_id,client_request_id,sequence,role,status,author_id,content,selected_source_ids,attempt_id,started_at)
          VALUES(?,?,?,?,?,'USER','PENDING',?,?, '[]'::jsonb,?,now())
          """,user,workspace,conversation,request.clientRequestId(),sequence,caller,request.instruction(),attempt);
        jdbc.update("""
          INSERT INTO canvas_turns(id,workspace_id,conversation_id,document_id,context_id,caller_id,client_request_id,request_hash,request,status,user_message_id)
          SELECT ?,?,?,?,?,?,?,?,?::jsonb,'ACCEPTED',? FROM ai_conversations WHERE workspace_id=? AND id=? AND origin IS NOT NULL
          """,turn,workspace,conversation,conversations.find(workspace,conversation).origin().documentId(),request.contextId(),caller,request.clientRequestId(),hash(request),json.writeValueAsString(request),user,workspace,conversation);
        return find(workspace,conversation,turn);
    }
    @Override @Transactional(readOnly=true) public TurnState find(UUID workspace,UUID conversation,UUID turn) {
        return jdbc.query("SELECT * FROM canvas_turns WHERE workspace_id=? AND conversation_id=? AND id=?",(r,i)->state(r),workspace,conversation,turn).stream().findFirst().orElseThrow(PostgresCanvasTurnStore::missing);
    }
    @Override @Transactional(readOnly=true) public List<TurnState> history(UUID workspace,UUID conversation,List<UUID> ids) {
        if(ids.isEmpty())return List.of();
        var args=new ArrayList<Object>(List.of(workspace,conversation));args.addAll(ids);
        return jdbc.query("SELECT * FROM canvas_turns WHERE workspace_id=? AND conversation_id=? AND user_message_id IN ("+String.join(",",Collections.nCopies(ids.size(),"?"))+") ORDER BY created_at,id",(r,i)->state(r),args.toArray());
    }
    @Override @Transactional public Optional<Work> claim() {
        // Reclaim an interrupted lease. Completion is fenced by a new UUID; one inference per dispatcher tick.
        var rows=jdbc.queryForList("SELECT * FROM canvas_turns WHERE status='ACCEPTED' OR status='PLANNING' AND started_at<now()-interval '5 minutes' OR status='EXECUTING' AND (lease_id IS NULL AND started_at<now()-interval '2 seconds' OR started_at<now()-interval '5 minutes') ORDER BY created_at,id LIMIT 1 FOR UPDATE SKIP LOCKED");
        if(rows.isEmpty())return Optional.empty();
        var row=rows.getFirst();UUID turn=(UUID)row.get("id"),workspace=(UUID)row.get("workspace_id"),conversation=(UUID)row.get("conversation_id"),lease=UUID.randomUUID();
        boolean observing="EXECUTING".equals(row.get("status"));
        boolean savedPlan=row.get("analysis_id")!=null && Boolean.TRUE.equals(jdbc.queryForObject("SELECT EXISTS(SELECT 1 FROM analyses WHERE workspace_id=? AND id=? AND status='READY_TO_EXECUTE')",Boolean.class,workspace,row.get("analysis_id")));
        if(Boolean.TRUE.equals(row.get("model_started")) && !observing && !savedPlan) {
            // Inference may already have been charged. Expiry fences the response and requires a new explicit turn.
            jdbc.update("UPDATE canvas_turns SET status='FAILED',failure_code='AI_UNAVAILABLE',completed_at=now(),lease_id=NULL WHERE id=?",turn);
            jdbc.update("UPDATE ai_messages SET status='FAILED',error_code='AI_UNAVAILABLE',completed_at=now() WHERE id=? AND status='PENDING'",row.get("user_message_id"));
            return Optional.empty();
        }
        jdbc.update("UPDATE canvas_turns SET status=?,lease_id=?,started_at=now() WHERE id=?",observing?"EXECUTING":"PLANNING",lease,turn);
        jdbc.update("UPDATE ai_messages SET status='PENDING',attempt_id=?,started_at=now(),completed_at=NULL,error_code=NULL WHERE id=?",lease,row.get("user_message_id"));
        var user=conversations.history(workspace,conversation,null,1).messages().stream().filter(m->m.id().equals(row.get("user_message_id"))).findFirst().orElseThrow();
        var work=new Work(workspace,(UUID)row.get("caller_id"),conversation,(UUID)row.get("document_id"),turn,lease,
            json.readValue(row.get("request").toString(),Turn.class),new Claim(lease,user,null));
        if(!observing)observation.record(work,dev.researchhub.audit.application.ProductAudit.CanvasStage.QUEUE,Math.max(0,java.time.Duration.between(((java.sql.Timestamp)row.get("created_at")).toInstant(),java.time.Instant.now()).toMillis()),true);
        return Optional.of(work);
    }
    private boolean lock(Work work) {
        return !jdbc.queryForList("SELECT id FROM canvas_turns WHERE id=? AND status IN ('PLANNING','EXECUTING') AND lease_id=? FOR UPDATE",work.turnId(),work.leaseId()).isEmpty();
    }
    @Override @Transactional public boolean beginModel(Work work) {
        if(!lock(work))return false;
        if(Boolean.TRUE.equals(jdbc.queryForObject("SELECT model_started FROM canvas_turns WHERE id=?",Boolean.class,work.turnId())))return false;
        quotas.admit(work.callerId(),work.workspaceId(),dev.researchhub.security.application.CostCategory.LLM,quota);
        return jdbc.update("UPDATE canvas_turns SET model_started=true WHERE id=? AND status='PLANNING' AND lease_id=? AND model_started=false",work.turnId(),work.leaseId())==1;
    }
    @org.springframework.beans.factory.annotation.Value("${researchhub.security.quotas.retrieval.user:60}") private int retrievalUser=60;
    @org.springframework.beans.factory.annotation.Value("${researchhub.security.quotas.retrieval.workspace:180}") private int retrievalWorkspace=180;
    @Override @Transactional public void admitRetrieval(Work work) {
        if(!lock(work))throw new ConflictException("The turn is no longer active");
        quotas.admit(work.callerId(),work.workspaceId(),dev.researchhub.security.application.CostCategory.RETRIEVAL,
            new dev.researchhub.security.application.QuotaPolicy(retrievalUser,retrievalWorkspace,quota.window()));
    }
    @Override @Transactional public void proposal(Work work,CanvasProposalContracts.Proposal proposal,MemorySummary memory) {
        documents.lockForReview(work.workspaceId(),work.callerId(),work.documentId());
        contexts.resolve(work.workspaceId(),work.documentId(),work.callerId(),proposal.contextId());
        sources.requireSourceVersions(work.workspaceId(),work.callerId(),work.request().scope().sourceVersionIds());
        if(!lock(work))return;
        new PostgresCanvasProposalStore(jdbc,json).save(proposal);
        var completion=conversations.completeCanvas(work.workspaceId(),work.conversationId(),work.claim(),new CanvasResult("EDIT_PROPOSAL",proposal.id(),"Review the proposed text before applying it to the document."));
        jdbc.update("UPDATE canvas_turns SET status='PROPOSAL_READY',message_id=?,canvas_proposal_id=?,result_kind='EDIT_PROPOSAL',memory_summary=?::jsonb,completed_at=now() WHERE id=?",completion.assistant().id(),proposal.id(),json.writeValueAsString(memory),work.turnId());
    }
    @Override @Transactional public void problem(Work work,String statement,MemorySummary memory) {
        documents.lockForReview(work.workspaceId(),work.callerId(),work.documentId());if(!lock(work))return;
        var ctx=contexts.find(work.workspaceId(),work.documentId(),work.callerId(),work.request().contextId());
        var outputs=new ArrayList<dev.researchhub.analysis.application.ProblemContracts.Output>();if(ctx.snapshot().formulas().size()==1){var ast=ctx.snapshot().formulas().getFirst().path("ast");outputs.add(new dev.researchhub.analysis.application.ProblemContracts.Output("result",ast.path("op").asString().equals("eq")?"SOLVE":"EVALUATE",ast,null));}
        var problem=new dev.researchhub.analysis.application.ProblemContracts.Problem(CanvasFollowupContext.head(statement,4000),List.of(),List.of(),null,outputs,List.of(),null);
        var origin=new dev.researchhub.analysis.application.ProblemContracts.Origin(work.documentId(),work.request().contextId(),work.conversationId(),work.claim().user().id());
        var command=new dev.researchhub.analysis.application.ProblemContracts.Create("2.0","PROBLEM",work.turnId(),CanvasFollowupContext.head(work.request().instruction(),4000),problem,origin,null);
        var analysis=problems.create(work.workspaceId(),work.callerId(),command);
        var completion=conversations.completeCanvas(work.workspaceId(),work.conversationId(),work.claim(),new CanvasResult("PROBLEM_HANDOFF",null,analysis.id(),"The problem and exact document context are saved. Provide explicit parameters, units, domain and formula in Analysis Studio before calculation."));
        jdbc.update("UPDATE canvas_turns SET status='WAITING_FOR_INPUT',message_id=?,analysis_id=?,result_kind='PROBLEM_HANDOFF',memory_summary=?::jsonb,completed_at=now() WHERE id=?",completion.assistant().id(),analysis.id(),json.writeValueAsString(memory),work.turnId());
    }
    @Override @Transactional public void analysis(Work work,List<dev.researchhub.analysis.application.AnalysisContracts.Input> inputs,MemorySummary memory) {
        documents.lockForReview(work.workspaceId(),work.callerId(),work.documentId());
        if(!lock(work))return;
        var analysis=analyses.create(work.workspaceId(),work.callerId(),new dev.researchhub.analysis.application.AnalysisContracts.Create(CanvasFollowupContext.head(work.request().instruction(),4000),inputs));
        var completion=conversations.completeCanvas(work.workspaceId(),work.conversationId(),work.claim(),new CanvasResult("ANALYSIS_HANDOFF",null,analysis.id(),"The dataset analysis request is saved. Open Analysis Studio to inspect its plan and start the isolated execution."));
        jdbc.update("UPDATE canvas_turns SET status='COMPLETED',message_id=?,analysis_id=?,result_kind='ANALYSIS_HANDOFF',memory_summary=?::jsonb,completed_at=now() WHERE id=?",completion.assistant().id(),analysis.id(),json.writeValueAsString(memory),work.turnId());
    }
    @Override @Transactional public UUID prepareDataset(Work work,List<dev.researchhub.analysis.application.AnalysisContracts.Input> inputs,MemorySummary memory) {
        documents.lockForReview(work.workspaceId(),work.callerId(),work.documentId());
        if(!lock(work))throw new ConflictException("The turn is no longer active");
        var state=find(work.workspaceId(),work.conversationId(),work.turnId());
        if(state.analysisId()!=null)return state.analysisId();
        quotas.admit(work.callerId(),work.workspaceId(),dev.researchhub.security.application.CostCategory.ANALYSIS,new dev.researchhub.security.application.QuotaPolicy(analysisUser,analysisWorkspace,quota.window()));
        var a=analyses.create(work.workspaceId(),work.callerId(),new dev.researchhub.analysis.application.AnalysisContracts.Create(head(work.request().instruction(),4000),inputs));
        jdbc.update("UPDATE canvas_turns SET analysis_id=?,memory_summary=?::jsonb WHERE id=?",a.id(),json.writeValueAsString(memory),work.turnId());
        return a.id();
    }
    @Override @Transactional public void startDatasetExecution(Work work) {
        documents.lockForReview(work.workspaceId(),work.callerId(),work.documentId());
        if(!lock(work))return;
        var state=find(work.workspaceId(),work.conversationId(),work.turnId());
        if(state.executionId()!=null)return;
        quotas.admit(work.callerId(),work.workspaceId(),dev.researchhub.security.application.CostCategory.ANALYSIS,new dev.researchhub.security.application.QuotaPolicy(analysisUser,analysisWorkspace,quota.window()));
        var e=executions.enqueue(work.workspaceId(),work.callerId(),state.analysisId());
        jdbc.update("UPDATE canvas_turns SET status='EXECUTING',execution_id=?,lease_id=NULL,started_at=now() WHERE id=?",e.id(),work.turnId());
    }
    @Override @Transactional public void deferExecution(Work work) {
        if(!lock(work))return;
        jdbc.update("UPDATE canvas_turns SET lease_id=NULL,started_at=now() WHERE id=?",work.turnId());
    }
    @Override @Transactional public void finishExecution(Work work,String text) {
        documents.lockForReview(work.workspaceId(),work.callerId(),work.documentId());
        if(!lock(work))return;
        var state=find(work.workspaceId(),work.conversationId(),work.turnId());
        var completion=conversations.completeCanvas(work.workspaceId(),work.conversationId(),work.claim(),new CanvasResult("ANALYSIS_RESULT",null,state.analysisId(),text));
        jdbc.update("UPDATE canvas_turns SET status='COMPLETED',message_id=?,result_kind='ANALYSIS_RESULT',completed_at=now(),lease_id=NULL WHERE id=?",completion.assistant().id(),work.turnId());
    }
    @Override @Transactional public void complete(Work work,QuestionContracts.Response response,String kind,MemorySummary memory) {
        if(!lock(work))return;
        var completion=Set.of("ANALYSIS_HANDOFF","PROBLEM_HANDOFF").contains(kind)
            ? conversations.completeCanvas(work.workspaceId(),work.conversationId(),work.claim(),new CanvasResult(kind,null,response.answer()))
            : conversations.complete(work.workspaceId(),work.conversationId(),work.claim(),response);
        UUID reference=work.request().targetProposalId();
        var canvasRef=reference==null ? Optional.<CanvasProposalContracts.Proposal>empty() : new PostgresCanvasProposalStore(jdbc,json).reference(work.workspaceId(),work.documentId(),reference);
        boolean canvas=canvasRef.isPresent();
        jdbc.update("UPDATE canvas_turns SET status=?,message_id=?,proposal_id=?,canvas_proposal_id=?,result_kind=?,memory_summary=?::jsonb,completed_at=now() WHERE id=?",
            "ANSWER".equals(kind)?"COMPLETED":"WAITING_FOR_INPUT",completion.assistant().id(),canvas ? null : reference,canvas ? canvasRef.get().id() : null,kind,json.writeValueAsString(memory),work.turnId());
    }
    @Override @Transactional public void fail(Work work,ApiErrorCode code) {
        if(!lock(work))return;
        conversations.fail(work.workspaceId(),work.conversationId(),work.claim(),code,false);
        jdbc.update("UPDATE canvas_turns SET status='FAILED',failure_code=?,completed_at=now() WHERE id=?",code.name(),work.turnId());
    }
    @Override @Transactional public TurnState cancel(UUID workspace,UUID caller,UUID conversation,UUID turn) {
        var row=jdbc.queryForList("SELECT * FROM canvas_turns WHERE workspace_id=? AND conversation_id=? AND id=? FOR UPDATE",workspace,conversation,turn).stream().findFirst().orElseThrow(PostgresCanvasTurnStore::missing);
        if(!caller.equals(row.get("caller_id")))throw new ApiException(ApiErrorCode.FORBIDDEN,"Only the turn author can cancel this question");
        if(Set.of("ACCEPTED","PLANNING","EXECUTING").contains(row.get("status"))) {
            jdbc.update("UPDATE canvas_turns SET status='CANCELLED',completed_at=now(),lease_id=NULL WHERE id=?",turn);
            jdbc.update("UPDATE ai_messages SET status='ABANDONED',error_code='CONFLICT',completed_at=now() WHERE id=? AND status='PENDING'",row.get("user_message_id"));
        }
        return find(workspace,conversation,turn);
    }
    private static String head(String s,int n) {int end=Math.min(s.length(),n);if(end<s.length() && Character.isHighSurrogate(s.charAt(end-1)))end--;return s.substring(0,end);}
    private static ResourceNotFoundException missing() {return new ResourceNotFoundException("Contextual conversation or turn was not found");}
}
