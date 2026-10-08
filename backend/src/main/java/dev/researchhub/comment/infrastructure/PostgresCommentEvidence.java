package dev.researchhub.comment.infrastructure;

import dev.researchhub.comment.application.CommentEvidenceContracts.Suggestion;
import dev.researchhub.shared.error.ConflictException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import tools.jackson.databind.ObjectMapper;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.*;

@Repository
public class PostgresCommentEvidence {
    private final JdbcTemplate jdbc;
    private final ObjectMapper json;
    public PostgresCommentEvidence(JdbcTemplate jdbc, ObjectMapper json) { this.jdbc=jdbc; this.json=json; }
    public Optional<Suggestion> find(UUID workspace, UUID document, UUID comment, UUID id) {
        return jdbc.query("SELECT payload FROM comment_ai_suggestions WHERE workspace_id=? AND document_id=? AND comment_id=? AND id=?",
                (row,index) -> json.readValue(row.getString(1),Suggestion.class),workspace,document,comment,id).stream().findFirst();
    }
    public Map<UUID,List<Suggestion>> forDocument(UUID workspace, UUID document) {
        var accepted=new HashMap<UUID,List<String>>();
        jdbc.query("""
                SELECT a.suggestion_id,a.chunk_id FROM comment_ai_citation_acceptances a JOIN comment_ai_suggestions s ON s.id=a.suggestion_id
                WHERE s.workspace_id=? AND s.document_id=? ORDER BY a.created_at,a.chunk_id
                """, (org.springframework.jdbc.core.RowCallbackHandler) row -> accepted.computeIfAbsent(row.getObject(1,UUID.class),key -> new ArrayList<>()).add(row.getString(2)),workspace,document);
        var result=new HashMap<UUID,List<Suggestion>>();
        jdbc.query("SELECT payload FROM comment_ai_suggestions WHERE workspace_id=? AND document_id=? ORDER BY created_at,id",
                (org.springframework.jdbc.core.RowCallbackHandler) row -> {
                    var s=json.readValue(row.getString(1),Suggestion.class);
                    result.computeIfAbsent(s.commentId(),key -> new ArrayList<>()).add(new Suggestion(s.id(),s.commentId(),s.kind(),s.requestedBy(),s.requestedByName(),s.claim(),s.evidence(),s.createdAt(),accepted.getOrDefault(s.id(),List.of())));
                },workspace,document);
        return result;
    }
    public void append(UUID workspace, UUID document, Suggestion s) {
        if (jdbc.update("""
                INSERT INTO comment_ai_suggestions(id,workspace_id,document_id,comment_id,requested_by,payload,created_at)
                VALUES (?,?,?,?,?,?::jsonb,?) ON CONFLICT DO NOTHING
                """,s.id(),workspace,document,s.commentId(),s.requestedBy(),json.writeValueAsString(s),Timestamp.from(s.createdAt()))!=1)
            throw new ConflictException("This AI request id is already in use");
        jdbc.update("UPDATE document_comments SET updated_at=? WHERE workspace_id=? AND document_id=? AND id=?",Timestamp.from(s.createdAt()),workspace,document,s.commentId());
    }
    public boolean accept(UUID id, String chunk, UUID actor, long revision, Instant now) {
        return jdbc.update("""
                INSERT INTO comment_ai_citation_acceptances(suggestion_id,chunk_id,actor_user_id,document_revision,created_at)
                VALUES (?,?,?,?,?) ON CONFLICT DO NOTHING
                """,id,chunk,actor,revision,Timestamp.from(now))==1;
    }
    public boolean accepted(UUID id, String chunk) {
        return Boolean.TRUE.equals(jdbc.queryForObject("SELECT EXISTS (SELECT 1 FROM comment_ai_citation_acceptances WHERE suggestion_id=? AND chunk_id=?)",
                Boolean.class,id,chunk));
    }
}
