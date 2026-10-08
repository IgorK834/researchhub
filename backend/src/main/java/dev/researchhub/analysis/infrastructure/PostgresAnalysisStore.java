package dev.researchhub.analysis.infrastructure;

import dev.researchhub.analysis.application.*;
import dev.researchhub.analysis.application.AnalysisContracts.*;
import dev.researchhub.analysis.domain.AnalysisStatus;
import dev.researchhub.shared.error.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.ObjectMapper;
import java.time.Instant;
import java.sql.Timestamp;
import java.util.*;

@Repository
public class PostgresAnalysisStore implements AnalysisStore {
    private final JdbcTemplate jdbc;
    private final ObjectMapper json;
    public PostgresAnalysisStore(JdbcTemplate jdbc,ObjectMapper json) { this.jdbc=jdbc; this.json=json; }
    @Transactional public Analysis create(Analysis a) {
        jdbc.update("INSERT INTO analyses(id,workspace_id,created_by,user_prompt,status,created_at,updated_at,inputs) VALUES (?,?,?,?,'DRAFT',?,?,?::jsonb)",
            a.id(),a.workspaceId(),a.createdBy(),a.userPrompt(),Timestamp.from(a.createdAt()),Timestamp.from(a.updatedAt()),json.writeValueAsString(a.inputs()));
        for (int i=0;i<a.inputs().size();i++) {
            var input=a.inputs().get(i);
            jdbc.update("INSERT INTO analysis_inputs(analysis_id,workspace_id,source_id,source_version_id,ordinal) VALUES (?,?,?,?,?)",
                a.id(),a.workspaceId(),input.sourceId(),input.sourceVersionId(),i);
        }
        return a;
    }
    @Transactional public Analysis createDerived(Analysis a,ReproductionContracts.Lineage lineage) {
        create(a);
        jdbc.update("INSERT INTO analysis_origins(analysis_id,workspace_id,origin_analysis_id,origin_execution_id,payload,created_at) VALUES (?,?,?,?,?::jsonb,?)",
            a.id(),a.workspaceId(),lineage.originAnalysisId(),lineage.originExecutionId(),json.writeValueAsString(lineage),Timestamp.from(a.createdAt()));
        return a;
    }
    public Optional<ReproductionContracts.Lineage> origin(UUID workspace,UUID analysis) {
        return jdbc.query("SELECT payload FROM analysis_origins WHERE workspace_id=? AND analysis_id=?",
            (row,index) -> json.readValue(row.getString(1),ReproductionContracts.Lineage.class),workspace,analysis).stream().findFirst();
    }
    public Analysis find(UUID workspace,UUID id) {
        return query("SELECT * FROM analyses WHERE workspace_id=? AND id=?",workspace,id).stream().findFirst()
            .orElseThrow(() -> new ResourceNotFoundException("Analysis was not found"));
    }
    public List<Analysis> list(UUID workspace,int offset) {
        return query("SELECT * FROM analyses WHERE workspace_id=? ORDER BY created_at DESC,id DESC LIMIT 50 OFFSET ?",workspace,offset);
    }
    private List<Analysis> query(String sql,Object... args) {
        return jdbc.query(sql,(row,index) -> new Analysis(row.getObject("id",UUID.class),row.getObject("workspace_id",UUID.class),
            row.getObject("created_by",UUID.class),row.getString("user_prompt"),AnalysisStatus.valueOf(row.getString("status")),
            row.getTimestamp("created_at").toInstant(),row.getTimestamp("updated_at").toInstant(),
            Arrays.asList(json.readValue(row.getString("inputs"),Input[].class)),row.getObject("plan_id",UUID.class),
            row.getString("plan")==null ? null : json.readValue(row.getString("plan"),Plan.class),row.getString("failure_code")),args);
    }
    public boolean beginPlanning(UUID workspace,UUID id,Instant now) {
        return jdbc.update("UPDATE analyses SET status='PLANNING',updated_at=? WHERE workspace_id=? AND id=? AND status='DRAFT'",Timestamp.from(now),workspace,id)==1;
    }
    public void recordAttempt(UUID workspace,UUID id,PlanAudit audit) {
        jdbc.update("INSERT INTO analysis_plan_attempts(id,analysis_id,workspace_id,attempt,payload,created_at) VALUES (?,?,?,?,?::jsonb,?)",
            audit.id(),id,workspace,audit.attempt(),json.writeValueAsString(audit),Timestamp.from(audit.createdAt()));
    }
    public void complete(UUID workspace,UUID id,UUID planId,Plan plan,Instant now) {
        if (jdbc.update("UPDATE analyses SET status='READY_TO_EXECUTE',plan_id=?,plan=?::jsonb,updated_at=? WHERE workspace_id=? AND id=? AND status='PLANNING'",
            planId,json.writeValueAsString(plan),Timestamp.from(now),workspace,id)!=1) throw new ConflictException("Analysis planning state changed");
    }
    public void fail(UUID workspace,UUID id,String code,Instant now) {
        jdbc.update("UPDATE analyses SET status='FAILED',failure_code=?,updated_at=? WHERE workspace_id=? AND id=? AND status='PLANNING'",code,Timestamp.from(now),workspace,id);
    }
    public List<PlanAudit> attempts(UUID workspace,UUID id) {
        return jdbc.query("SELECT payload FROM analysis_plan_attempts WHERE workspace_id=? AND analysis_id=? ORDER BY attempt",
            (row,index) -> json.readValue(row.getString("payload"),PlanAudit.class),workspace,id);
    }
}
