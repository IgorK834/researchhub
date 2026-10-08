package dev.researchhub.ai.infrastructure;

import dev.researchhub.ai.application.*;
import dev.researchhub.ai.application.GenerationContracts.*;
import dev.researchhub.shared.error.ApiErrorCode;
import org.springframework.stereotype.Repository;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.ObjectMapper;
import java.util.*;

@Repository
public class PostgresGenerationStore implements GenerationStore {
    private final JdbcTemplate jdbc;
    private final ObjectMapper json;
    public PostgresGenerationStore(JdbcTemplate jdbc, ObjectMapper json) { this.jdbc = jdbc; this.json = json; }
    @Override @Transactional
    public void begin(UUID workspaceId, UUID callerId, ContextContracts.ContextualRequest contextual, List<Citation> evidence) {
        beginComputed(workspaceId,callerId,contextual,evidence,List.of());
    }
    @Override @Transactional public void beginComputed(UUID workspaceId,UUID callerId,ContextContracts.ContextualRequest contextual,List<Citation> evidence,
        List<dev.researchhub.analysis.application.AnalysisEvidenceService.Citation> computed) {
        var request = contextual.request();
        jdbc.update("""
            INSERT INTO ai_generation_runs(request_id, workspace_id, caller_id, feature_id, template_id, template_hash,
                request_hash, parameters, evidence, analysis_evidence, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?::jsonb, ?::jsonb, ?::jsonb, 'REQUESTED')
            """, request.requestId(), workspaceId, callerId, request.templateId().substring(0, request.templateId().lastIndexOf(':')), request.templateId(), request.templateHash(),
            RetrievalIdentity.hash(json.writeValueAsString(contextual)), json.writeValueAsString(Map.of("model", request.parameters(), "context", contextual.context().summary().budget())), json.writeValueAsString(evidence),json.writeValueAsString(computed));
    }
    @Override @Transactional
    public void succeed(UUID workspaceId, GeneratedResponse response) {
        complete(jdbc.update("""
            UPDATE ai_generation_runs SET status='SUCCEEDED', response=?::jsonb, completed_at=now()
            WHERE workspace_id=? AND request_id=? AND status='REQUESTED'
            """, json.writeValueAsString(response), workspaceId, response.result().requestId()));
    }
    @Override @Transactional
    public void fail(UUID workspaceId, UUID requestId, ApiErrorCode code) {
        complete(jdbc.update("""
            UPDATE ai_generation_runs SET status='FAILED', error_code=?, completed_at=now()
            WHERE workspace_id=? AND request_id=? AND status='REQUESTED'
            """, code.name(), workspaceId, requestId));
    }
    @Override @Transactional(readOnly = true)
    public Optional<GeneratedResponse> findCompleted(UUID workspaceId, UUID requestId) {
        return jdbc.query("SELECT response FROM ai_generation_runs WHERE workspace_id=? AND request_id=? AND status='SUCCEEDED'",
            (row, _index) -> json.readValue(row.getString(1), GeneratedResponse.class), workspaceId, requestId).stream().findFirst();
    }
    private static void complete(int rows) { if (rows != 1) throw new IllegalStateException("Generation call was already finalized or belongs to another workspace"); }
}
