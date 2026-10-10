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
    private final JdbcTemplate jdbc;private final ObjectMapper json;private final ConversationStore conversations;
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
            r.getObject("message_id",UUID.class),r.getObject("proposal_id",UUID.class),r.getObject("execution_id",UUID.class),
            failure==null ? null : ApiErrorCode.valueOf(failure),request.contextId(),request.intent(),request.scope(),r.getString("result_kind"),
            memory==null ? null : json.readValue(memory,MemorySummary.class));
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
        if(Boolean.TRUE.equals(jdbc.queryForObject("SELECT EXISTS(SELECT 1 FROM canvas_turns WHERE workspace_id=? AND conversation_id=? AND status IN ('ACCEPTED','PLANNING'))",Boolean.class,workspace,conversation)))
            throw new ConflictException("Wait for the current turn before sending another question");
        quotas.admit(caller,workspace,dev.researchhub.security.application.CostCategory.LLM,quota);
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
        var rows=jdbc.queryForList("SELECT * FROM canvas_turns WHERE status='ACCEPTED' OR status='PLANNING' AND started_at<now()-interval '5 minutes' ORDER BY created_at,id LIMIT 1 FOR UPDATE SKIP LOCKED");
        if(rows.isEmpty())return Optional.empty();
        var row=rows.getFirst();UUID turn=(UUID)row.get("id"),workspace=(UUID)row.get("workspace_id"),conversation=(UUID)row.get("conversation_id"),lease=UUID.randomUUID();
        jdbc.update("UPDATE canvas_turns SET status='PLANNING',lease_id=?,started_at=now() WHERE id=?",lease,turn);
        jdbc.update("UPDATE ai_messages SET status='PENDING',attempt_id=?,started_at=now(),completed_at=NULL,error_code=NULL WHERE id=?",lease,row.get("user_message_id"));
        var user=conversations.history(workspace,conversation,null,1).messages().stream().filter(m->m.id().equals(row.get("user_message_id"))).findFirst().orElseThrow();
        return Optional.of(new Work(workspace,(UUID)row.get("caller_id"),conversation,(UUID)row.get("document_id"),turn,lease,
            json.readValue(row.get("request").toString(),Turn.class),new Claim(lease,user,null)));
    }
    private boolean lock(Work work) {
        return !jdbc.queryForList("SELECT id FROM canvas_turns WHERE id=? AND status='PLANNING' AND lease_id=? FOR UPDATE",work.turnId(),work.leaseId()).isEmpty();
    }
    @Override @Transactional public void complete(Work work,QuestionContracts.Response response,String kind,MemorySummary memory) {
        if(!lock(work))return;
        var completion=conversations.complete(work.workspaceId(),work.conversationId(),work.claim(),response);
        jdbc.update("UPDATE canvas_turns SET status=?,message_id=?,proposal_id=?,result_kind=?,memory_summary=?::jsonb,completed_at=now() WHERE id=?",
            "CLARIFICATION".equals(kind)?"WAITING_FOR_INPUT":"COMPLETED",completion.assistant().id(),work.request().targetProposalId(),kind,json.writeValueAsString(memory),work.turnId());
    }
    @Override @Transactional public void fail(Work work,ApiErrorCode code) {
        if(!lock(work))return;
        conversations.fail(work.workspaceId(),work.conversationId(),work.claim(),code,false);
        jdbc.update("UPDATE canvas_turns SET status='FAILED',failure_code=?,completed_at=now() WHERE id=?",code.name(),work.turnId());
    }
    @Override @Transactional public TurnState cancel(UUID workspace,UUID caller,UUID conversation,UUID turn) {
        var row=jdbc.queryForList("SELECT * FROM canvas_turns WHERE workspace_id=? AND conversation_id=? AND id=? FOR UPDATE",workspace,conversation,turn).stream().findFirst().orElseThrow(PostgresCanvasTurnStore::missing);
        if(!caller.equals(row.get("caller_id")))throw new ApiException(ApiErrorCode.FORBIDDEN,"Only the turn author can cancel this question");
        if(Set.of("ACCEPTED","PLANNING").contains(row.get("status"))) {
            jdbc.update("UPDATE canvas_turns SET status='CANCELLED',completed_at=now(),lease_id=NULL WHERE id=?",turn);
            jdbc.update("UPDATE ai_messages SET status='ABANDONED',error_code='CONFLICT',completed_at=now() WHERE id=? AND status='PENDING'",row.get("user_message_id"));
        }
        return find(workspace,conversation,turn);
    }
    private static String head(String s,int n) {int end=Math.min(s.length(),n);if(end<s.length() && Character.isHighSurrogate(s.charAt(end-1)))end--;return s.substring(0,end);}
    private static ResourceNotFoundException missing() {return new ResourceNotFoundException("Contextual conversation or turn was not found");}
}
