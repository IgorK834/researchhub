package dev.researchhub.ai.infrastructure;

import dev.researchhub.ai.application.*;
import dev.researchhub.ai.application.ConversationContracts.*;
import dev.researchhub.shared.error.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.ObjectMapper;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.*;
import java.util.*;
import java.util.concurrent.CancellationException;

/** Scoped persistence of visible questions and complete answers. No provider payload is accepted. */
@Repository
public class PostgresConversationStore implements ConversationStore {
    private static final Duration LEASE = Duration.ofMinutes(5);
    private final JdbcTemplate jdbc;
    private final ObjectMapper json;
    public PostgresConversationStore(JdbcTemplate jdbc,ObjectMapper json) { this.jdbc=jdbc; this.json=json; }
    private final RowMapper<Conversation> conversationMapper=(row,index) -> new Conversation(row.getObject("id",UUID.class),
        row.getObject("workspace_id",UUID.class),row.getObject("created_by",UUID.class),row.getString("title"),
        row.getTimestamp("created_at").toInstant(),row.getTimestamp("updated_at").toInstant(),
        origin(row.getString("origin")));
    private CanvasConversationContracts.Origin origin(String value) {return value==null?null:json.readValue(value,CanvasConversationContracts.Origin.class);}
    private Message message(ResultSet row) throws SQLException {
        String selected=row.getString("selected_source_ids"), response=row.getString("response");
        var completed=row.getTimestamp("completed_at");
        return new Message(row.getObject("id",UUID.class),row.getObject("client_request_id",UUID.class),row.getLong("sequence"),
            row.getString("role"),row.getString("status"),row.getObject("author_id",UUID.class),row.getString("content"),
            selected == null ? null : List.of(json.readValue(selected,UUID[].class)),
            response == null ? null : json.readValue(response,QuestionContracts.Response.class),row.getString("error_code"),
            row.getTimestamp("created_at").toInstant(),completed == null ? null : completed.toInstant(),
            List.of(json.readValue(row.getString("selected_analysis_outputs"),dev.researchhub.analysis.application.AnalysisEvidenceService.Reference[].class)));
    }
    @Override @Transactional
    public Conversation create(UUID workspaceId,UUID callerId,String title) {
        UUID id=UUID.randomUUID();
        jdbc.update("INSERT INTO ai_conversations(id,workspace_id,created_by,title) VALUES (?,?,?,?)",id,workspaceId,callerId,title);
        return find(workspaceId,id);
    }
    @Override @Transactional(readOnly=true)
    public ConversationPage list(UUID workspaceId,int offset,int limit) {
        var rows=jdbc.query("SELECT * FROM ai_conversations WHERE workspace_id=? ORDER BY updated_at DESC,id DESC LIMIT ? OFFSET ?",
            conversationMapper,workspaceId,limit+1,offset);
        boolean more=rows.size()>limit;
        return new ConversationPage(rows.subList(0,Math.min(rows.size(),limit)),more ? offset+limit : null);
    }
    @Override @Transactional(readOnly=true)
    public Conversation find(UUID workspaceId,UUID conversationId) { return conversation(workspaceId,conversationId,false); }
    private Conversation conversation(UUID workspaceId,UUID conversationId,boolean lock) {
        return jdbc.query("SELECT * FROM ai_conversations WHERE workspace_id=? AND id=?"+(lock ? " FOR UPDATE" : ""),
            conversationMapper,workspaceId,conversationId).stream().findFirst().orElseThrow(PostgresConversationStore::missing);
    }
    @Override @Transactional
    public History history(UUID workspaceId,UUID conversationId,Long beforeSequence,int limit) {
        var conversation=find(workspaceId,conversationId);
        expire(workspaceId,conversationId);
        var args=new ArrayList<Object>(List.of(workspaceId,conversationId));
        if (beforeSequence != null) args.add(beforeSequence);
        args.add(limit+1);
        var turns=jdbc.queryForList("SELECT sequence FROM ai_messages WHERE workspace_id=? AND conversation_id=? AND role='USER'"
            +(beforeSequence == null ? "" : " AND sequence<?")+" ORDER BY sequence DESC LIMIT ?",Long.class,args.toArray());
        boolean more=turns.size()>limit;
        turns=turns.subList(0,Math.min(turns.size(),limit));
        if (turns.isEmpty()) return new History(conversation,List.of(),null);
        var sequences=new ArrayList<Long>(); turns.forEach(sequence -> { sequences.add(sequence); sequences.add(sequence+1); });
        args=new ArrayList<>(List.of(workspaceId,conversationId)); args.addAll(sequences);
        var messages=jdbc.query("SELECT * FROM ai_messages WHERE workspace_id=? AND conversation_id=? AND sequence IN ("
            +String.join(",",Collections.nCopies(sequences.size(),"?"))+") ORDER BY sequence",(row,index)->message(row),args.toArray());
        return new History(conversation,messages,more ? turns.getLast() : null);
    }
    private void expire(UUID workspaceId,UUID conversationId) {
        jdbc.update("""
            UPDATE ai_messages SET status='ABANDONED',error_code='CONFLICT',completed_at=now()
            WHERE workspace_id=? AND conversation_id=? AND role='USER' AND status='PENDING'
                AND started_at < now()-interval '5 minutes' AND NOT EXISTS (SELECT 1 FROM canvas_turns t WHERE t.user_message_id=ai_messages.id)
            """,workspaceId,conversationId);
    }
    private record Stored(Message message,UUID attemptId,Instant startedAt) {}
    @Override @Transactional
    public Claim claim(UUID workspaceId,UUID conversationId,UUID callerId,Send send) {
        conversation(workspaceId,conversationId,true);
        var rows=jdbc.query("SELECT * FROM ai_messages WHERE workspace_id=? AND conversation_id=? AND client_request_id=? AND role='USER' FOR UPDATE",
            (row,index)->new Stored(message(row),row.getObject("attempt_id",UUID.class),row.getTimestamp("started_at").toInstant()),
            workspaceId,conversationId,send.clientRequestId());
        UUID attempt=UUID.randomUUID();
        if (!rows.isEmpty()) {
            var existing=rows.getFirst();
            if (!existing.message().content().equals(send.question()) || !Objects.equals(existing.message().selectedSourceIds(),send.selectedSourceIds())
                || !existing.message().selectedAnalysisOutputs().equals(send.selectedAnalysisOutputs()))
                throw new ConflictException("The request identity belongs to a different question");
            if ("COMPLETED".equals(existing.message().status())) {
                var assistant=jdbc.query("SELECT * FROM ai_messages WHERE workspace_id=? AND conversation_id=? AND client_request_id=? AND role='ASSISTANT'",
                    (row,index)->message(row),workspaceId,conversationId,send.clientRequestId()).getFirst();
                return new Claim(null,existing.message(),assistant);
            }
            if (!callerId.equals(existing.message().authorId())) throw new ConflictException("Only the question author can retry this request");
            if ("PENDING".equals(existing.message().status()) && existing.startedAt().plus(LEASE).isAfter(Instant.now()))
                throw new ConflictException("This question is still running; reload the conversation");
            jdbc.update("UPDATE ai_messages SET status='PENDING',attempt_id=?,started_at=now(),completed_at=NULL,error_code=NULL WHERE workspace_id=? AND id=?",
                attempt,workspaceId,existing.message().id());
            return new Claim(attempt,user(workspaceId,conversationId,send.clientRequestId()),null);
        }
        long sequence=Objects.requireNonNull(jdbc.queryForObject("UPDATE ai_conversations SET next_sequence=next_sequence+2,updated_at=now() WHERE workspace_id=? AND id=? RETURNING next_sequence-2",
            Long.class,workspaceId,conversationId));
        jdbc.update("""
            INSERT INTO ai_messages(id,workspace_id,conversation_id,client_request_id,sequence,role,status,author_id,content,selected_source_ids,selected_analysis_outputs,attempt_id,started_at)
            VALUES (?,?,?,?,?,'USER','PENDING',?,?,?::jsonb,?::jsonb,?,now())
            """,UUID.randomUUID(),workspaceId,conversationId,send.clientRequestId(),sequence,callerId,send.question(),
            send.selectedSourceIds() == null ? null : json.writeValueAsString(send.selectedSourceIds()),json.writeValueAsString(send.selectedAnalysisOutputs()),attempt);
        return new Claim(attempt,user(workspaceId,conversationId,send.clientRequestId()),null);
    }
    private Message user(UUID workspaceId,UUID conversationId,UUID requestId) {
        return jdbc.query("SELECT * FROM ai_messages WHERE workspace_id=? AND conversation_id=? AND client_request_id=? AND role='USER'",
            (row,index)->message(row),workspaceId,conversationId,requestId).getFirst();
    }
    @Override @Transactional
    public Completion complete(UUID workspaceId,UUID conversationId,Claim claim,QuestionContracts.Response response) throws CancellationException {
        conversation(workspaceId,conversationId,true);
        int updated=jdbc.update("UPDATE ai_messages SET status='COMPLETED',completed_at=now() WHERE workspace_id=? AND conversation_id=? AND id=? AND status='PENDING' AND attempt_id=?",
            workspaceId,conversationId,claim.user().id(),claim.attemptId());
        if (updated != 1) throw new CancellationException("The conversation attempt is no longer active");
        var result=response.generation() == null ? null : response.generation().result();
        UUID assistantId=UUID.randomUUID();
        jdbc.update("""
            INSERT INTO ai_messages(id,workspace_id,conversation_id,client_request_id,sequence,role,status,content,citations,
                model,usage,template_id,template_hash,generation_id,response,completed_at)
            VALUES (?,?,?,?,?,'ASSISTANT','COMPLETED',?,?::jsonb,?::jsonb,?::jsonb,?,?,?,?::jsonb,now())
            """,assistantId,workspaceId,conversationId,claim.user().clientRequestId(),claim.user().sequence()+1,response.answer(),
            json.writeValueAsString(response.citations()),result == null ? null : json.writeValueAsString(result.model()),
            result == null ? null : json.writeValueAsString(result.usage()),result == null ? null : result.templateId(),
            result == null ? null : result.templateHash(),result == null ? null : result.requestId(),json.writeValueAsString(response));
        jdbc.update("UPDATE ai_conversations SET updated_at=now() WHERE workspace_id=? AND id=?",workspaceId,conversationId);
        var assistant=jdbc.query("SELECT * FROM ai_messages WHERE workspace_id=? AND conversation_id=? AND id=?",(row,index)->message(row),workspaceId,conversationId,assistantId).getFirst();
        return new Completion(user(workspaceId,conversationId,claim.user().clientRequestId()),assistant);
    }
    @Override @Transactional
    public void fail(UUID workspaceId,UUID conversationId,Claim claim,ApiErrorCode code,boolean abandoned) {
        jdbc.update("UPDATE ai_messages SET status=?,error_code=?,completed_at=now() WHERE workspace_id=? AND conversation_id=? AND id=? AND status='PENDING' AND attempt_id=?",
            abandoned ? "ABANDONED" : "FAILED",code.name(),workspaceId,conversationId,claim.user().id(),claim.attemptId());
    }
    private static ResourceNotFoundException missing() { return new ResourceNotFoundException("Research conversation was not found"); }
}
