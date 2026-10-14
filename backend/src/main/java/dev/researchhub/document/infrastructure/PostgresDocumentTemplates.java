package dev.researchhub.document.infrastructure;

import dev.researchhub.document.application.DocumentTemplateContracts.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.*;

@Repository
public class PostgresDocumentTemplates {
    public record Receipt(String requestSha256,Origin origin) {}
    private final JdbcTemplate jdbc;
    public PostgresDocumentTemplates(JdbcTemplate jdbc){this.jdbc=jdbc;}
    public Optional<Receipt> receipt(UUID workspace,UUID caller,UUID request) {
        return jdbc.query("SELECT * FROM document_template_creations WHERE workspace_id=? AND created_by=? AND client_request_id=?",
            (row,i)->new Receipt(row.getString("request_sha256"),origin(row)),workspace,caller,request).stream().findFirst();
    }
    public Optional<Origin> origin(UUID workspace,UUID document) {
        return jdbc.query("SELECT * FROM document_template_creations WHERE workspace_id=? AND document_id=?",
            (row,i)->origin(row),workspace,document).stream().findFirst();
    }
    private Origin origin(java.sql.ResultSet row)throws java.sql.SQLException {
        return new Origin(row.getObject("document_id",UUID.class),row.getString("template_id"),row.getInt("template_version"),
            row.getString("locale"),row.getString("template_sha256"),row.getString("content_sha256"),row.getTimestamp("created_at").toInstant());
    }
    public void create(UUID workspace,UUID caller,UUID request,String requestHash,Origin origin) {
        jdbc.update("""
            INSERT INTO document_template_creations(workspace_id,created_by,client_request_id,request_sha256,document_id,
                template_id,template_version,locale,template_sha256,content_sha256,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)
            """,workspace,caller,request,requestHash,origin.documentId(),origin.templateId(),origin.version(),origin.locale(),
            origin.templateSha256(),origin.initialContentSha256(),Timestamp.from(origin.createdAt()));
    }
}
