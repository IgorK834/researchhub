package dev.researchhub.analysis.infrastructure;

import dev.researchhub.analysis.application.*;
import dev.researchhub.analysis.application.ProblemContracts.*;
import dev.researchhub.shared.error.*;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

import tools.jackson.databind.ObjectMapper;

import java.util.*;

@Repository
public class PostgresProblemStore implements ProblemStore {
    private final JdbcTemplate jdbc;
    private final ObjectMapper json;

    public PostgresProblemStore(JdbcTemplate jdbc, ObjectMapper json) {
        this.jdbc = jdbc;
        this.json = json;
    }

    @Transactional
    public Analysis create(Analysis a, Create command, String hash) {
        jdbc.queryForList(
                "SELECT pg_advisory_xact_lock(hashtextextended(?,0))",
                a.workspaceId() + ":" + command.clientRequestId());
        var existing =
                jdbc.query(
                        "SELECT request_hash,created_by,payload FROM analysis_problems WHERE"
                                + " workspace_id=? AND client_request_id=?",
                        (rs, i) -> {
                            if (!hash.equals(rs.getString(1))
                                    || !a.createdBy().equals(rs.getObject(2, UUID.class)))
                                throw new ConflictException("Problem request identity was reused");
                            return json.readValue(rs.getString(3), Analysis.class);
                        },
                        a.workspaceId(),
                        command.clientRequestId());
        if (!existing.isEmpty()) return existing.getFirst();
        jdbc.update(
                "INSERT INTO"
                    + " analyses(id,workspace_id,created_by,user_prompt,status,created_at,updated_at,inputs,workload)"
                    + " VALUES(?,?,?,?,'DRAFT',?,?, '[]'::jsonb,'PROBLEM')",
                a.id(),
                a.workspaceId(),
                a.createdBy(),
                a.userPrompt(),
                java.sql.Timestamp.from(a.createdAt()),
                java.sql.Timestamp.from(a.createdAt()));
        jdbc.update(
                "INSERT INTO"
                    + " analysis_problems(analysis_id,workspace_id,created_by,client_request_id,request_hash,command,payload,parent_analysis_id)"
                    + " VALUES(?,?,?,?,?,?::jsonb,?::jsonb,?)",
                a.id(),
                a.workspaceId(),
                a.createdBy(),
                command.clientRequestId(),
                hash,
                json.writeValueAsString(command),
                json.writeValueAsString(a),
                a.parentAnalysisId());
        return a;
    }

    public Optional<Analysis> find(UUID w, UUID id) {
        return jdbc
                .query(
                        "SELECT payload FROM analysis_problems WHERE workspace_id=? AND"
                                + " analysis_id=?",
                        (rs, i) -> json.readValue(rs.getString(1), Analysis.class),
                        w,
                        id)
                .stream()
                .findFirst();
    }

    public boolean beginPlan(UUID w, UUID id) {
        return jdbc.update(
                        "UPDATE analysis_problems SET"
                            + " planning_started_at=now(),payload=jsonb_set(payload,'{status}','\"PLANNING\"')"
                            + " WHERE workspace_id=? AND analysis_id=? AND"
                            + " payload->>'status'='DRAFT'",
                        w,
                        id)
                == 1;
    }

    public void planned(Analysis a) {
        jdbc.update(
                "UPDATE analysis_problems SET payload=?::jsonb WHERE workspace_id=? AND"
                        + " analysis_id=? AND payload->>'status'='PLANNING'",
                json.writeValueAsString(a),
                a.workspaceId(),
                a.id());
    }

    @Transactional
    public Execution enqueue(
            UUID w, UUID caller, Execution e, ReproductionContracts.RuntimeIdentity runtime) {
        jdbc.queryForList(
                "SELECT analysis_id FROM analysis_problems WHERE workspace_id=? AND analysis_id=?"
                        + " FOR UPDATE",
                w,
                e.analysisId());
        var active =
                jdbc.query(
                        "SELECT payload FROM problem_executions WHERE workspace_id=? AND"
                                + " analysis_id=? AND status IN ('QUEUED','RUNNING')",
                        (rs, i) -> json.readValue(rs.getString(1), Execution.class),
                        w,
                        e.analysisId());
        if (!active.isEmpty()) return active.getFirst();
        jdbc.update(
                "INSERT INTO"
                    + " problem_executions(id,workspace_id,analysis_id,requested_by,status,payload,saved_runtime)"
                    + " VALUES(?,?,?,?,'QUEUED',?::jsonb,?::jsonb)",
                e.id(),
                w,
                e.analysisId(),
                caller,
                json.writeValueAsString(e),
                runtime == null ? null : json.writeValueAsString(runtime));
        return e;
    }

    public List<Execution> executions(UUID w, UUID a) {
        return jdbc.query(
                        "SELECT payload FROM problem_executions WHERE workspace_id=? AND"
                                + " analysis_id=? ORDER BY created_at DESC,id DESC LIMIT 100",
                        (rs, i) -> json.readValue(rs.getString(1), Execution.class),
                        w,
                        a)
                .reversed();
    }

    public Optional<Execution> execution(UUID workspace, UUID analysis, UUID execution) {
        return jdbc
                .query(
                        "SELECT payload FROM problem_executions WHERE workspace_id=? AND"
                                + " analysis_id=? AND id=?",
                        (rs, i) -> json.readValue(rs.getString(1), Execution.class),
                        workspace,
                        analysis,
                        execution)
                .stream()
                .findFirst();
    }

    @Transactional
    public Optional<Job> claim() {
        jdbc.update(
                "UPDATE analysis_problems SET"
                    + " payload=jsonb_set(jsonb_set(payload,'{status}','\"FAILED\"'),'{missing}','[\"Planning"
                    + " was interrupted; create a new problem request.\"]') WHERE"
                    + " payload->>'status'='PLANNING' AND planning_started_at<now()-interval '10"
                    + " minutes'");
        // Interrupted attempts fail; no automatic repeat of model or computation.
        jdbc.update(
                "UPDATE problem_executions SET"
                    + " status='FAILED',payload=jsonb_set(jsonb_set(jsonb_set(jsonb_set(payload,'{status}','\"FAILED\"'),'{failureCode}','\"EXECUTION_INTERRUPTED\"'),'{completedAt}',to_jsonb(now())),'{computationStatus}','\"INTERRUPTED\"')"
                    + " WHERE status='RUNNING' AND started_at<now()-interval '10 minutes'");
        var jobs =
                jdbc.query(
                        "SELECT id,workspace_id,requested_by,payload,saved_runtime FROM"
                            + " problem_executions WHERE status='QUEUED' ORDER BY created_at FOR"
                            + " UPDATE SKIP LOCKED LIMIT 1",
                        (rs, i) ->
                                new Job(
                                        rs.getObject(2, UUID.class),
                                        rs.getObject(3, UUID.class),
                                        json.readValue(rs.getString(4), Execution.class),
                                        rs.getString(5) == null
                                                ? null
                                                : json.readValue(
                                                        rs.getString(5),
                                                        ReproductionContracts.RuntimeIdentity
                                                                .class)));
        if (jobs.isEmpty()) return Optional.empty();
        var j = jobs.getFirst();
        jdbc.update(
                "UPDATE problem_executions SET"
                    + " status='RUNNING',started_at=now(),payload=jsonb_set(jsonb_set(payload,'{status}','\"RUNNING\"'),'{computationStatus}','\"RUNNING\"')"
                    + " WHERE id=?",
                j.execution().id());
        return Optional.of(j);
    }

    @Transactional
    public void complete(UUID w, Execution e, Map<String, byte[]> files) {
        if (jdbc.update(
                        "UPDATE problem_executions SET status=?,payload=?::jsonb WHERE"
                                + " workspace_id=? AND id=? AND status='RUNNING'",
                        e.status(),
                        json.writeValueAsString(e),
                        w,
                        e.id())
                != 1) throw new ConflictException("Execution lease ended");
        for (var f : files.entrySet())
            if (f.getKey().endsWith(".png"))
                jdbc.update(
                        "INSERT INTO"
                            + " problem_artifacts(id,workspace_id,analysis_id,execution_id,name,media_type,sha256,content)"
                            + " VALUES(?,?,?,?,?,'image/png',?,?)",
                        UUID.randomUUID(),
                        w,
                        e.analysisId(),
                        e.id(),
                        f.getKey(),
                        java.util.HexFormat.of().formatHex(sha(f.getValue())),
                        f.getValue());
    }

    public byte[] artifact(UUID w, UUID a, UUID e, String name) {
        return jdbc
                .query(
                        "SELECT content,sha256 FROM problem_artifacts WHERE workspace_id=? AND"
                                + " analysis_id=? AND execution_id=? AND name=?",
                        (rs, i) -> {
                            byte[] content = rs.getBytes(1);
                            if (!java.util.HexFormat.of()
                                    .formatHex(sha(content))
                                    .equals(rs.getString(2)))
                                throw new ConflictException("Saved artifact hash does not match");
                            return content;
                        },
                        w,
                        a,
                        e,
                        name)
                .stream()
                .findFirst()
                .orElseThrow(() -> new ResourceNotFoundException("Artifact was not found"));
    }

    private static byte[] sha(byte[] b) {
        try {
            return java.security.MessageDigest.getInstance("SHA-256").digest(b);
        } catch (java.security.NoSuchAlgorithmException impossible) {
            throw new IllegalStateException(impossible);
        }
    }
}
