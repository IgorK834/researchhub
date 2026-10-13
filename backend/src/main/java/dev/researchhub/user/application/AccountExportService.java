package dev.researchhub.user.application;

import dev.researchhub.security.application.SecurityOperationLimiter;
import dev.researchhub.shared.error.ConflictException;
import dev.researchhub.user.infrastructure.PersonalDataInventory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.*;
import java.time.*;
import java.util.*;

/** Caller-owned JSON data, with explicit removal of credentials and binary download artifacts. */
@Service
public class AccountExportService {
    public record Export(String schemaVersion,Instant generatedAt,AccountSecurityService.Identity account,Map<String,List<JsonNode>> records) {}
    private final AccountSecurityService accounts;
    private final SecurityOperationLimiter limiter;
    private final JdbcTemplate jdbc;
    private final ObjectMapper json;
    private final Clock clock;
    public AccountExportService(AccountSecurityService accounts,SecurityOperationLimiter limiter,JdbcTemplate jdbc,ObjectMapper json,Clock clock) {
        this.accounts=accounts;this.limiter=limiter;this.jdbc=jdbc;this.json=json;this.clock=clock;
    }
    @Transactional
    public Export export(UUID caller) {
        var account=accounts.require(caller);
        limiter.admit(caller.toString(),SecurityOperationLimiter.Operation.ACCOUNT_EXPORT);
        var records=new TreeMap<String,List<JsonNode>>();
        var reader=new Reader(caller);
        for(var entry:PersonalDataInventory.CONTRIBUTIONS.entrySet())
            records.put(entry.getKey(),reader.rows(entry.getKey(),entry.getValue()+"=?",caller,entry.getKey().equals("report_exports") ? "ARRAY['content']" : "ARRAY[]::text[]"));
        records.put("workspace_members",reader.rows("workspace_members","user_id=?",caller,"ARRAY[]::text[]"));
        records.put("workspaces",reader.rows("workspaces","created_by=?",caller,"ARRAY[]::text[]"));
        records.put("document_versions",reader.rows("document_versions","created_by=?",caller,"ARRAY['yjs_state']"));
        records.put("product_audit_events",reader.rows("product_audit_events","actor_user_id=?",caller,"ARRAY[]::text[]"));
        records.put("comment_audit_events",reader.rows("comment_audit_events","actor_id=?",caller,"ARRAY[]::text[]"));
        records.put("account_audit_events",reader.rows("account_audit_events","user_id=?",caller,"ARRAY[]::text[]"));
        records.put("workspace_invitation",reader.rows("workspace_invitation","invited_by=? OR email_normalized=?",new Object[]{caller,account.normalizedEmail()},"ARRAY['token_hash']"));
        records.put("account_lifecycle_token",reader.rows("account_lifecycle_token","email_normalized=?",account.normalizedEmail(),"ARRAY['token_hash']"));
        for(String table:List.of("analysis_inputs","analysis_plan_attempts","analysis_origins"))
            records.put(table,reader.rows(table,"analysis_id IN (SELECT id FROM analyses WHERE created_by=?)",caller,"ARRAY[]::text[]"));
        for(String table:List.of("analysis_execution_records","analysis_execution_artifacts"))
            records.put(table,reader.rows(table,"execution_id IN (SELECT id FROM analysis_executions WHERE requested_by=?)",caller,table.equals("analysis_execution_artifacts")?"ARRAY['content']":"ARRAY[]::text[]"));
        records.put("canvas_proposals",reader.rows("canvas_proposals","context_id IN (SELECT id FROM canvas_contexts WHERE created_by=?)",caller,"ARRAY[]::text[]"));
        records.put("source_version_extractions",reader.rows("source_version_extractions","source_version_id IN (SELECT id FROM source_versions WHERE uploaded_by=?)",caller,"ARRAY[]::text[]"));
        records.put("source_extractions",reader.rows("source_extractions","source_id IN (SELECT id FROM sources WHERE uploaded_by=?)",caller,"ARRAY[]::text[]"));
        records.put("bibliography_import_records",reader.rows("bibliography_import_records",
            "import_id IN (SELECT id FROM bibliography_imports WHERE created_by=?)",caller,"ARRAY[]::text[]"));
        jdbc.update("INSERT INTO account_audit_events VALUES (?,?,'ACCOUNT_EXPORTED',?)",UUID.randomUUID(),caller,java.sql.Timestamp.from(clock.instant()));
        return new Export("1.0",clock.instant(),account,Collections.unmodifiableMap(records));
    }
    private final class Reader {
        private final UUID caller;
        private long bytes;
        Reader(UUID caller) { this.caller=caller; }
        private List<JsonNode> rows(String table,String predicate,Object parameter,String excluded) {return rows(table,predicate,new Object[]{parameter},excluded);}
        private List<JsonNode> rows(String table,String predicate,Object[] parameters,String excluded) {
            var bound=new ArrayList<>(Arrays.asList(parameters));
            // Exporting one's identity does not grant access to collaborators' retained research.
            if(PersonalDataInventory.CONTRIBUTIONS.containsKey(table) || Set.of("document_content_operations","comment_audit_events","product_audit_events","source_version_extractions","source_extractions","analysis_inputs","analysis_plan_attempts","analysis_origins","analysis_execution_records","analysis_execution_artifacts","canvas_proposals","bibliography_import_records").contains(table)) {
                predicate="("+predicate+") AND workspace_id IN (SELECT m.workspace_id FROM workspace_members m JOIN workspaces w ON w.id=m.workspace_id WHERE m.user_id=? AND w.erasure_requested_at IS NULL)";
                bound.add(caller);
            } else if(table.equals("document_versions")) {
                predicate="("+predicate+") AND document_id IN (SELECT d.id FROM documents d JOIN workspace_members m ON m.workspace_id=d.workspace_id JOIN workspaces w ON w.id=d.workspace_id WHERE m.user_id=? AND w.erasure_requested_at IS NULL)";
                bound.add(caller);
            } else if(table.equals("workspaces")) {
                predicate="("+predicate+") AND id IN (SELECT workspace_id FROM workspace_members WHERE user_id=?) AND erasure_requested_at IS NULL";
                bound.add(caller);
            }
            var result=new ArrayList<JsonNode>();
            jdbc.query("SELECT to_jsonb(t)-ARRAY['storage_key','password_hash','receipt_hash','token_hash']-"+excluded+" FROM "+table+" t WHERE "+predicate+" LIMIT 100001",
                (org.springframework.jdbc.core.RowCallbackHandler) r -> {
                    String raw=r.getString(1); bytes+=raw.getBytes(java.nio.charset.StandardCharsets.UTF_8).length;
                    if(bytes>64L*1024*1024 || result.size()>=100000)throw new ConflictException("Account JSON export exceeds its 64 MiB / 100000 records per table limit; export source files and documents separately");
                    result.add(json.readTree(raw));
                },bound.toArray());
            return List.copyOf(result);
        }
    }
}
