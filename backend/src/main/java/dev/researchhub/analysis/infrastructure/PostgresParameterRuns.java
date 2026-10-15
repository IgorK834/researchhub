package dev.researchhub.analysis.infrastructure;

import dev.researchhub.analysis.application.ParameterRunContracts.*;
import dev.researchhub.shared.error.ConflictException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import java.util.*;

@Repository
public class PostgresParameterRuns {
    private final JdbcTemplate jdbc;
    public PostgresParameterRuns(JdbcTemplate jdbc){this.jdbc=jdbc;}
    public Optional<Result> existing(UUID workspace,UUID parent,UUID user,UUID key,String hash) {
        jdbc.queryForList("SELECT pg_advisory_xact_lock(hashtextextended(?,0))",workspace+":"+parent+":"+user+":"+key);
        return jdbc.query("SELECT request_hash,analysis_id,execution_id FROM analysis_parameter_runs WHERE workspace_id=? AND parent_analysis_id=? AND requested_by=? AND idempotency_key=?",(r,i)->{
            if(!hash.equals(r.getString(1)))throw new ConflictException("Idempotency key was reused with different parameters");
            return new Result(parent,r.getObject(2,UUID.class),r.getObject(3,UUID.class),"APPROVED_PLAN",0);
        },workspace,parent,user,key).stream().findFirst();
    }
    public void save(UUID workspace,UUID user,UUID key,String hash,Result result) {
        jdbc.update("INSERT INTO analysis_parameter_runs VALUES(?,?,?,?,?,?,?)",workspace,result.parentAnalysisId(),user,key,hash,result.analysisId(),result.executionId());
    }
}
