package dev.researchhub.audit.application;

import dev.researchhub.security.application.SecurityOperationLimiter;
import dev.researchhub.shared.error.*;
import dev.researchhub.workspace.application.WorkspaceAuthorizationService;
import dev.researchhub.workspace.domain.WorkspaceCapability;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.ObjectMapper;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.sql.Timestamp;
import java.time.*;
import java.util.*;

/** Bounded keyset streaming over safe audit headers, including review and model calls. */
@Service
public class AuditExportService {
    public static final int PAGE_SIZE=200, MAX_ROWS=100_000;
    public record Ticket(UUID id, UUID workspace, UUID caller, Instant cutoff, String format) {}
    public record Row(UUID id, String kind, UUID actorId, String event, String resourceType, UUID resourceId, Instant createdAt) {}
    private final JdbcTemplate jdbc;
    private final WorkspaceAuthorizationService authorization;
    private final SecurityOperationLimiter limiter;
    private final ProductAudit audit;
    private final ObjectMapper json;
    private final Clock clock;
    public AuditExportService(JdbcTemplate jdbc, WorkspaceAuthorizationService authorization, SecurityOperationLimiter limiter,
            ProductAudit audit, ObjectMapper json, Clock clock) {
        this.jdbc=jdbc; this.authorization=authorization; this.limiter=limiter; this.audit=audit; this.json=json; this.clock=clock;
    }
    @Transactional
    public Ticket prepare(UUID workspace, UUID caller, String format) {
        authorization.requireCapability(workspace,caller,WorkspaceCapability.MANAGE_WORKSPACE);
        if (!Set.of("csv","json").contains(format)) throw new ApiException(ApiErrorCode.VALIDATION_FAILED,"Audit format must be csv or json");
        limiter.admit(caller+":"+workspace,SecurityOperationLimiter.Operation.AUDIT_EXPORT);
        Instant cutoff=clock.instant();
        Long count=jdbc.queryForObject("""
            SELECT (SELECT count(*) FROM product_audit_events WHERE workspace_id=? AND created_at<?)
                 + (SELECT count(*) FROM comment_audit_events WHERE workspace_id=? AND created_at<?)
                 + (SELECT count(*) FROM ai_generation_runs WHERE workspace_id=? AND created_at<?)
            """,Long.class,workspace,Timestamp.from(cutoff),workspace,Timestamp.from(cutoff),workspace,Timestamp.from(cutoff));
        if (count>MAX_ROWS) throw new ConflictException("Audit export exceeds 100000 events; use the paged audit history API");
        var ticket=new Ticket(UUID.randomUUID(),workspace,caller,cutoff,format);
        audit.auditExported(workspace,caller,ticket.id());
        return ticket;
    }
    public void stream(Ticket ticket, OutputStream output) throws IOException {
        var writer=new BufferedWriter(new OutputStreamWriter(output,StandardCharsets.UTF_8));
        boolean csv=ticket.format().equals("csv"), first=true;
        writer.write(csv ? "id,kind,actorId,event,resourceType,resourceId,createdAt\r\n" : "[");
        Instant after=Instant.EPOCH; UUID id=new UUID(0,0); String kind=""; int emitted=0;
        while (true) {
            authorization.requireCapability(ticket.workspace(),ticket.caller(),WorkspaceCapability.MANAGE_WORKSPACE);
            var page=page(ticket,after,id,kind);
            for (var row:page) {
                if (++emitted>MAX_ROWS) throw new IOException("Audit export limit exceeded");
                if (csv) writer.write(String.join(",",row.id().toString(),row.kind(),Objects.toString(row.actorId(),""),row.event(),row.resourceType(),row.resourceId().toString(),row.createdAt().toString())+"\r\n");
                else { if (!first) writer.write(","); writer.write(json.writeValueAsString(row)); }
                first=false;
            }
            writer.flush();
            if (page.size()<PAGE_SIZE) break;
            var last=page.getLast(); after=last.createdAt(); id=last.id(); kind=last.kind();
        }
        if (!csv) writer.write("]");
        writer.flush();
    }
    private List<Row> page(Ticket ticket,Instant after,UUID id,String kind) {
        return jdbc.query("""
            WITH headers AS (
              SELECT id,'PRODUCT' AS kind,actor_user_id AS actor,event_type AS event,resource_type,resource_id,created_at
                FROM product_audit_events WHERE workspace_id=?
              UNION ALL
              SELECT id,'REVIEW',actor_id,action,'COMMENT',comment_id,created_at FROM comment_audit_events WHERE workspace_id=?
              UNION ALL
              SELECT request_id,'AI',caller_id,status,'AI_GENERATION',request_id,created_at FROM ai_generation_runs WHERE workspace_id=?
            ) SELECT * FROM headers WHERE created_at<? AND (created_at,id,kind)>(?,?::uuid,?)
              ORDER BY created_at,id,kind LIMIT ?
            """, (r,i)->new Row(r.getObject("id",UUID.class),r.getString("kind"),r.getObject("actor",UUID.class),r.getString("event"),
                r.getString("resource_type"),r.getObject("resource_id",UUID.class),r.getTimestamp("created_at").toInstant()),
            ticket.workspace(),ticket.workspace(),ticket.workspace(),Timestamp.from(ticket.cutoff()),Timestamp.from(after),id,kind,PAGE_SIZE);
    }
}
