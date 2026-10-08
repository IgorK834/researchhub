package dev.researchhub.analysis.infrastructure;

import dev.researchhub.audit.application.ProductAudit;

import dev.researchhub.analysis.application.ExecutionStore;
import dev.researchhub.analysis.application.ExecutionContracts.*;
import dev.researchhub.shared.error.*;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.ObjectMapper;

@Repository
public class PostgresExecutionStore implements ExecutionStore {
    private final JdbcTemplate jdbc;
    private final ObjectMapper json;
    private final ProductAudit audit;
    public PostgresExecutionStore(JdbcTemplate jdbc,ObjectMapper json,ProductAudit audit) { this.jdbc=jdbc; this.json=json; this.audit=audit; }
    @Transactional public Execution enqueue(UUID workspace,UUID analysis,UUID caller,Provenance provenance,Snapshot snapshot,Instant now) {
        var statuses=jdbc.query("SELECT status FROM analyses WHERE workspace_id=? AND id=? AND plan_id=? FOR UPDATE",
            (row,index) -> row.getString(1),workspace,analysis,provenance.planId());
        if (statuses.isEmpty() || !Set.of("READY_TO_EXECUTE","SUCCEEDED","FAILED").contains(statuses.getFirst()))
            throw new ConflictException("Analysis already has an active execution or has no accepted plan");
        Integer next=jdbc.queryForObject("SELECT coalesce(max(attempt),0)+1 FROM analysis_executions WHERE analysis_id=?",Integer.class,analysis);
        if (next==null || next>100) throw new ConflictException("Analysis execution attempt limit reached");
        var execution=new Execution(UUID.randomUUID(),analysis,workspace,caller,next,Status.QUEUED,now,null,null,provenance,null,null,null);
        jdbc.update("INSERT INTO analysis_executions(id,analysis_id,workspace_id,requested_by,attempt,status,payload,created_at,request_id) VALUES (?,?,?,?,?,'QUEUED',?::jsonb,?,?)",
            execution.id(),analysis,workspace,caller,next,json.writeValueAsString(execution),Timestamp.from(now),
            dev.researchhub.shared.observability.CorrelationContext.currentOrNew());
        jdbc.update("INSERT INTO analysis_execution_records(execution_id,analysis_id,workspace_id,snapshot,created_at) VALUES (?,?,?,?::jsonb,?)",
            execution.id(),analysis,workspace,json.writeValueAsString(snapshot),Timestamp.from(now));
        jdbc.update("UPDATE analyses SET status='QUEUED',failure_code=NULL,updated_at=? WHERE workspace_id=? AND id=?",Timestamp.from(now),workspace,analysis);
        try (var scope=dev.researchhub.shared.observability.CorrelationContext.open(requestId(execution.id()),
                java.util.Map.of("jobId",execution.id().toString(),"analysisId",analysis.toString()))) {
            org.slf4j.LoggerFactory.getLogger(getClass()).atInfo().addKeyValue("event", "analysis.execution.enqueued").log("Analysis execution enqueued");
        }
        return execution;
    }
    public String requestId(UUID executionId) {
        return jdbc.queryForObject("SELECT coalesce(request_id,id::text) FROM analysis_executions WHERE id=?",String.class,executionId);
    }
    @Transactional public Optional<Execution> claim(Instant now) {
        var queued=query("SELECT payload FROM analysis_executions WHERE status='QUEUED' ORDER BY created_at,id LIMIT 1 FOR UPDATE SKIP LOCKED");
        if (queued.isEmpty()) return Optional.empty();
        var old=queued.getFirst();
        var claimed=new Execution(old.id(),old.analysisId(),old.workspaceId(),old.requestedBy(),old.attempt(),Status.RUNNING,
            old.createdAt(),now,null,old.provenance(),null,null,null);
        jdbc.update("UPDATE analysis_executions SET status='RUNNING',started_at=?,payload=?::jsonb WHERE id=?",
            Timestamp.from(now),json.writeValueAsString(claimed),old.id());
        jdbc.update("UPDATE analyses SET status='RUNNING',updated_at=? WHERE workspace_id=? AND id=?",Timestamp.from(now),old.workspaceId(),old.analysisId());
        return Optional.of(claimed);
    }
    @Transactional public void complete(Execution claimed,Provenance provenance,Validated result,Failure failure,Diagnostics diagnostics,Instant now) {
        var active=jdbc.query("SELECT id FROM analysis_executions WHERE id=? AND status='RUNNING' FOR UPDATE",
            (row,index) -> row.getObject(1,UUID.class),claimed.id());
        if (active.isEmpty()) return;
        if (failure==null && result==null) throw new IllegalArgumentException("Execution must contain a result or failure");
        var done=new Execution(claimed.id(),claimed.analysisId(),claimed.workspaceId(),claimed.requestedBy(),claimed.attempt(),
            failure==null ? Status.SUCCEEDED : Status.FAILED,claimed.createdAt(),claimed.startedAt(),now,provenance,
            failure==null ? result.result() : null,failure,diagnostics);
        if (failure==null) for (var output:result.result().outputs()) if (output.artifact()!=null) {
            var artifact=output.artifact();
            jdbc.update("INSERT INTO analysis_execution_artifacts(id,execution_id,analysis_id,workspace_id,filename,media_type,size_bytes,sha256,content) VALUES (?,?,?,?,?,?,?,?,?)",
                artifact.id(),claimed.id(),claimed.analysisId(),claimed.workspaceId(),artifact.filename(),artifact.mediaType(),artifact.sizeBytes(),artifact.sha256(),result.artifacts().get(artifact.id()));
        }
        jdbc.update("UPDATE analysis_executions SET status=?,finished_at=?,payload=?::jsonb WHERE id=?",done.status().name(),Timestamp.from(now),json.writeValueAsString(done),claimed.id());
        jdbc.update("UPDATE analyses SET status=?,failure_code=?,updated_at=? WHERE workspace_id=? AND id=? AND status='RUNNING'",
            done.status().name(),failure==null ? null : failure.name(),Timestamp.from(now),claimed.workspaceId(),claimed.analysisId());
        audit.analysisExecuted(claimed.workspaceId(),claimed.requestedBy(),claimed.id(),claimed.analysisId(),failure==null);
    }
    @Transactional public void recoverInterrupted(Instant before,Instant now) {
        var stale=query("SELECT payload FROM analysis_executions WHERE status='RUNNING' AND started_at<? FOR UPDATE SKIP LOCKED",Timestamp.from(before));
        stale.forEach(e -> complete(e,e.provenance(),null,Failure.EXECUTION_INTERRUPTED,null,now));
    }
    public Execution find(UUID workspace,UUID analysis,UUID execution) {
        return query("SELECT payload FROM analysis_executions WHERE workspace_id=? AND analysis_id=? AND id=?",workspace,analysis,execution)
            .stream().findFirst().orElseThrow(() -> new ResourceNotFoundException("Execution was not found"));
    }
    public List<Execution> list(UUID workspace,UUID analysis) {
        return query("SELECT payload FROM analysis_executions WHERE workspace_id=? AND analysis_id=? ORDER BY attempt",workspace,analysis);
    }
    public ExecutionRecord record(UUID workspace,UUID analysis,UUID executionId) {
        Execution execution=find(workspace,analysis,executionId);
        Snapshot snapshot=jdbc.query("SELECT snapshot FROM analysis_execution_records WHERE workspace_id=? AND analysis_id=? AND execution_id=?",
            (row,index) -> json.readValue(row.getString(1),Snapshot.class),workspace,analysis,executionId).stream().findFirst()
            .orElseThrow(() -> new ResourceNotFoundException("Execution record was not found"));
        String codeSha256=execution.provenance().codeSha256();
        List<Chart> charts=execution.result()==null ? List.of() : execution.result().outputs().stream()
            .filter(o -> o.kind()==dev.researchhub.analysis.application.AnalysisContracts.OutputKind.CHART)
            .map(o -> new Chart(o.name(),o.chart()==null ? o.name() : o.chart().title(),o.chart()==null ? null : o.chart().xAxis(),
                o.chart()==null ? null : o.chart().yAxis(),o.chart()==null ? List.of() : o.chart().series(),analysis,executionId,
                codeSha256,o.artifact(),o.chart()!=null)).toList();
        // Existing v1 attempts remain immutable in storage; sanitize their historical diagnostics on read as well.
        if (execution.diagnostics()!=null) {
            var d=execution.diagnostics();var out=dev.researchhub.analysis.application.ExecutionLogSanitizer.summarize(d.stdout());
            var err=dev.researchhub.analysis.application.ExecutionLogSanitizer.summarize(d.stderr());
            execution=new Execution(execution.id(),execution.analysisId(),execution.workspaceId(),execution.requestedBy(),execution.attempt(),execution.status(),
                execution.createdAt(),execution.startedAt(),execution.finishedAt(),execution.provenance(),execution.result(),execution.failureCode(),
                new Diagnostics(d.exitCode(),d.timedOut(),out.text(),err.text(),d.stdoutTruncated()||out.truncated(),d.stderrTruncated()||err.truncated(),d.durationMillis(),d.configuredImage()));
        }
        return new ExecutionRecord("1.0",snapshot,execution,charts);
    }
    public ArtifactContent artifact(UUID workspace,UUID analysis,UUID execution,UUID artifact) {
        return jdbc.query("SELECT * FROM analysis_execution_artifacts WHERE workspace_id=? AND analysis_id=? AND execution_id=? AND id=?",
            (row,index) -> new ArtifactContent(new Artifact(row.getObject("id",UUID.class),row.getString("filename"),row.getString("media_type"),
                row.getLong("size_bytes"),row.getString("sha256")),row.getBytes("content")),workspace,analysis,execution,artifact).stream().findFirst()
            .orElseThrow(() -> new ResourceNotFoundException("Execution artifact was not found"));
    }
    private List<Execution> query(String sql,Object... args) {
        return jdbc.query(sql,(row,index) -> json.readValue(row.getString("payload"),Execution.class),args);
    }
}
