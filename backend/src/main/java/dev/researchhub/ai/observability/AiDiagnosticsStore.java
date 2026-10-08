package dev.researchhub.ai.observability;

import java.util.*;
import java.time.Instant;
import org.springframework.stereotype.Repository;
import org.springframework.jdbc.core.JdbcTemplate;
import tools.jackson.databind.ObjectMapper;
import static dev.researchhub.ai.observability.AiDiagnostics.*;

@Repository
public class AiDiagnosticsStore {
    private final JdbcTemplate jdbc;
    private final ObjectMapper json;
    public AiDiagnosticsStore(JdbcTemplate jdbc, ObjectMapper json) { this.jdbc=jdbc; this.json=json; }
    public void usage(UsageEvent event) {
        jdbc.update("""
            INSERT INTO ai_usage_events(request_id,workspace_id,feature,provider,model,model_version,template_id,status,
                input_tokens,output_tokens,usage_estimated,latency_ms,cost_usd,started_at,details)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?::jsonb)
            """, event.requestId(),event.workspaceId(),event.feature().name(),event.model()==null ? null : event.model().provider(),
            event.model()==null ? null : event.model().name(),event.model()==null ? null : event.model().version(),event.templateId(),event.status(),
            event.usage()==null ? null : event.usage().inputTokens(),event.usage()==null ? null : event.usage().outputTokens(),
            event.usage()==null ? null : event.usage().estimated(),event.latencyMs(),event.cost()==null ? null : event.cost().usd(),
            java.sql.Timestamp.from(event.startedAt()),json.writeValueAsString(event));
    }
    public Optional<UsageEvent> usage(UUID workspace, UUID request) {
        return jdbc.query("SELECT details FROM ai_usage_events WHERE workspace_id=? AND request_id=?",
            (row,index) -> json.readValue(row.getString(1),UsageEvent.class),workspace,request).stream().findFirst();
    }
    public void trace(Trace trace) {
        jdbc.update("""
            INSERT INTO ai_rag_traces(id,workspace_id,started_at,details) VALUES (?,?,?,?::jsonb)
            ON CONFLICT (id) DO UPDATE SET details=EXCLUDED.details WHERE ai_rag_traces.workspace_id=EXCLUDED.workspace_id
            """,trace.id(),trace.workspaceId(),java.sql.Timestamp.from(trace.startedAt()),json.writeValueAsString(trace));
    }
    public Optional<Trace> trace(UUID workspace, UUID id) {
        return jdbc.query("SELECT details FROM ai_rag_traces WHERE workspace_id=? AND id=?",
            (row,index)->json.readValue(row.getString(1),Trace.class),workspace,id).stream().findFirst();
    }
    public List<TraceSummary> traces(UUID workspace, Instant since) {
        return jdbc.query("SELECT details FROM ai_rag_traces WHERE workspace_id=? AND started_at>=? ORDER BY started_at DESC,id DESC LIMIT 50",
            (row,index)-> { var t=json.readValue(row.getString(1),Trace.class); return new TraceSummary(t.id(),t.correlationId(),t.startedAt(),t.status(),t.errorCode(),t.generationRequestId(),t.query(),t.hits().size()); },
            workspace,java.sql.Timestamp.from(since));
    }
    /** Private diagnostic captures have a short, fixed retention; economic metadata remains comparable. */
    @org.springframework.scheduling.annotation.Scheduled(fixedDelayString="PT1H")
    public void expireTraces() { jdbc.update("DELETE FROM ai_rag_traces WHERE started_at < now() - interval '7 days'"); }
    public List<Aggregate> aggregate(UUID workspace, Instant since) {
        return jdbc.query("""
            SELECT feature,provider,model,model_version,template_id,status,count(*) AS requests,count(input_tokens) AS known,
                count(*) FILTER (WHERE usage_estimated) AS estimated,sum(input_tokens)::bigint AS inputs,sum(output_tokens)::bigint AS outputs,
                count(cost_usd) AS costs,sum(cost_usd) AS usd,avg(latency_ms) AS latency
            FROM ai_usage_events WHERE workspace_id=? AND started_at>=?
            GROUP BY feature,provider,model,model_version,template_id,status ORDER BY feature,model,template_id,status
            """, (r,index)-> new Aggregate(Feature.valueOf(r.getString("feature")),r.getString("provider"),r.getString("model"),r.getString("model_version"),
                r.getString("template_id"),r.getString("status"),r.getLong("requests"),r.getLong("known"),r.getLong("estimated"),
                r.getObject("inputs",Long.class),r.getObject("outputs",Long.class),r.getLong("costs"),r.getBigDecimal("usd"),r.getDouble("latency")),workspace,java.sql.Timestamp.from(since));
    }
}
