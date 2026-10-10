package dev.researchhub.ai.infrastructure;
import dev.researchhub.ai.application.*;
import dev.researchhub.ai.application.CanvasContracts.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import tools.jackson.databind.ObjectMapper;
import java.sql.Timestamp;
import java.util.*;
@Repository
public class PostgresCanvasContextStore implements CanvasContextStore {
    private final JdbcTemplate jdbc;private final ObjectMapper json;
    public PostgresCanvasContextStore(JdbcTemplate jdbc,ObjectMapper json) { this.jdbc=jdbc;this.json=json; }
    public Optional<Stored> replay(UUID workspace,UUID document,UUID caller,UUID request) {
        return read("SELECT request_hash,request::text,context::text FROM canvas_contexts WHERE workspace_id=? AND document_id=? AND created_by=? AND client_request_id=?",workspace,document,caller,request);
    }
    public Optional<Stored> find(UUID workspace,UUID document,UUID id) {
        return read("SELECT request_hash,request::text,context::text FROM canvas_contexts WHERE workspace_id=? AND document_id=? AND id=?",workspace,document,id);
    }
    public Optional<Stored> findById(UUID workspace,UUID id) {
        return read("SELECT request_hash,request::text,context::text FROM canvas_contexts WHERE workspace_id=? AND id=?",workspace,id);
    }
    private Optional<Stored> read(String sql,Object... args) {
        return jdbc.query(sql,(rs,row) -> new Stored(rs.getString(1),json.readValue(rs.getString(2),Capture.class),json.readValue(rs.getString(3),Context.class)),args).stream().findFirst();
    }
    public void insert(UUID caller,String hash,Capture request,Context context) {
        jdbc.update("INSERT INTO canvas_contexts(id,workspace_id,document_id,created_by,client_request_id,request_hash,request,context,created_at) VALUES(?,?,?,?,?,?,?::jsonb,?::jsonb,?)",
            context.contextId(),context.workspaceId(),context.documentId(),caller,request.clientRequestId(),hash,json.writeValueAsString(request),json.writeValueAsString(context),Timestamp.from(context.createdAt()));
    }
}
