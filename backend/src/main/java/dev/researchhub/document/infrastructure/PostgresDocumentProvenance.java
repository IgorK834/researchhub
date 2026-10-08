package dev.researchhub.document.infrastructure;

import dev.researchhub.document.application.DocumentProvenance.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import tools.jackson.databind.ObjectMapper;
import java.sql.Timestamp;
import java.util.*;

@Repository
public class PostgresDocumentProvenance {
    private final JdbcTemplate jdbc;
    private final ObjectMapper json;
    public PostgresDocumentProvenance(JdbcTemplate jdbc,ObjectMapper json) { this.jdbc=jdbc; this.json=json; }
    public void append(UUID workspace,UUID document,Operation operation,String hash) {
        jdbc.update("INSERT INTO document_content_operations(id,workspace_id,document_id,block_id,category,actor_user_id,actor_name,operation_type,source_operation_id,metadata,content_sha256,document_revision,created_at) VALUES (?,?,?,?,?,?,?,?,?,?::jsonb,?,?,?)",
                operation.id(),workspace,document,operation.blockId(),operation.category().name(),operation.actorUserId(),operation.actorName(),
                operation.operationType(),operation.sourceOperationId(),json.writeValueAsString(operation.metadata()),hash,operation.documentRevision(),Timestamp.from(operation.createdAt()));
    }
    public Map<UUID,String> latestHashes(UUID workspace,UUID document) {
        Map<UUID,String> result=new HashMap<>();
        jdbc.query("SELECT DISTINCT ON(block_id) block_id,content_sha256 FROM document_content_operations WHERE workspace_id=? AND document_id=? ORDER BY block_id,document_revision DESC,sequence DESC",
                row -> { result.put(row.getObject(1,UUID.class),row.getString(2)); },workspace,document);
        return result;
    }
    public List<Operation> history(UUID workspace,UUID document,UUID block,int limit) {
        return jdbc.query("SELECT * FROM document_content_operations WHERE workspace_id=? AND document_id=? AND block_id=? ORDER BY document_revision DESC,sequence DESC LIMIT ?",
            (r,i) -> new Operation(r.getObject("id",UUID.class),block,Category.valueOf(r.getString("category")),r.getObject("actor_user_id",UUID.class),r.getString("actor_name"),r.getString("operation_type"),
                r.getObject("source_operation_id",UUID.class),json.readTree(r.getString("metadata")),r.getLong("document_revision"),r.getTimestamp("created_at").toInstant()),workspace,document,block,limit);
    }
}
