package dev.researchhub.ai.infrastructure;

import dev.researchhub.ai.application.*;
import dev.researchhub.ai.application.AuthoringContracts.*;
import dev.researchhub.shared.error.ResourceNotFoundException;
import org.springframework.context.annotation.Profile;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import tools.jackson.databind.ObjectMapper;
import java.util.UUID;

@Repository
@Profile("local")
public class PostgresAuthoringStore implements AuthoringStore {
    private final JdbcTemplate jdbc; private final ObjectMapper json;
    public PostgresAuthoringStore(JdbcTemplate jdbc, ObjectMapper json) { this.jdbc = jdbc; this.json = json; }
    public Suggestion save(Suggestion s) {
        jdbc.update("INSERT INTO ai_authoring_suggestions(id,workspace_id,document_id,created_by,state,payload,created_at) VALUES (?,?,?,?,'PENDING',?::jsonb,?)",
            s.id(),s.workspaceId(),s.documentId(),s.createdBy(),json.writeValueAsString(s),java.sql.Timestamp.from(s.createdAt()));
        return s;
    }
    public Suggestion find(UUID workspaceId, UUID documentId, UUID id, boolean lock) {
        return jdbc.query("SELECT payload,state,accepted_revision FROM ai_authoring_suggestions WHERE workspace_id=? AND document_id=? AND id=?" + (lock ? " FOR UPDATE" : ""),
            (row,index) -> {
                var s = json.readValue(row.getString("payload"), Suggestion.class);
                return new Suggestion(s.id(),s.workspaceId(),s.documentId(),s.createdBy(),row.getString("state"),s.command(),s.originalText(),
                    s.generatedText(),s.citations(),s.candidates(),s.warnings(),s.generation(),s.context(),s.createdAt(),row.getObject("accepted_revision",Long.class));
            },workspaceId,documentId,id).stream().findFirst().orElseThrow(() -> new ResourceNotFoundException("Authoring suggestion was not found"));
    }
    public void reject(UUID workspaceId, UUID id) { jdbc.update("UPDATE ai_authoring_suggestions SET state='REJECTED' WHERE workspace_id=? AND id=? AND state='PENDING'",workspaceId,id); }
    public void accept(UUID workspaceId, UUID id, UUID callerId, long revision, Accept command, String contentHash) {
        jdbc.update("INSERT INTO ai_authoring_events(id,workspace_id,document_id,accepted_by,revision,acceptance,content_hash) SELECT id,workspace_id,document_id,?,?,?::jsonb,? FROM ai_authoring_suggestions WHERE workspace_id=? AND id=?",
            callerId,revision,json.writeValueAsString(command),contentHash,workspaceId,id);
        jdbc.update("UPDATE ai_authoring_suggestions SET state='ACCEPTED',accepted_revision=? WHERE workspace_id=? AND id=?",revision,workspaceId,id);
    }
    public String acceptedInput(UUID workspaceId, UUID id) {
        return jdbc.queryForObject("SELECT acceptance::text FROM ai_authoring_events WHERE workspace_id=? AND id=?",String.class,workspaceId,id);
    }
}
