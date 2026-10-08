package dev.researchhub.ai.infrastructure;

import dev.researchhub.ai.application.SourceAnalysisContracts.Analysis;
import dev.researchhub.ai.application.SourceAnalysisStore;
import dev.researchhub.shared.error.ResourceNotFoundException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.ObjectMapper;
import java.util.UUID;

@Repository
public class PostgresSourceAnalysisStore implements SourceAnalysisStore {
    private final JdbcTemplate jdbc; private final ObjectMapper json;
    public PostgresSourceAnalysisStore(JdbcTemplate jdbc,ObjectMapper json) { this.jdbc=jdbc; this.json=json; }
    @Transactional
    public Analysis save(Analysis a) {
        jdbc.update("INSERT INTO ai_source_analyses(id,workspace_id,created_by,kind,parent_comparison_id,payload,created_at) VALUES (?,?,?,?,?,?::jsonb,?)",
            a.id(),a.workspaceId(),a.createdBy(),a.kind().name(),a.parentComparisonId(),json.writeValueAsString(a),java.sql.Timestamp.from(a.createdAt()));
        int[] inserted=jdbc.batchUpdate("""
                INSERT INTO ai_source_analysis_sources(analysis_id,source_id,source_version_id,ordinal)
                VALUES (?,?,?,?)
                """, java.util.stream.IntStream.range(0,a.sources().size()).mapToObj(index -> new Object[]{
                a.id(),a.sources().get(index).id(),a.sources().get(index).sourceVersionId(),index}).toList());
        if (inserted.length!=a.sources().size()) throw new IllegalStateException("Analysis source versions were not recorded");
        return a;
    }
    public Analysis find(UUID workspaceId,UUID id) {
        return jdbc.query("SELECT payload FROM ai_source_analyses WHERE workspace_id=? AND id=?",(row,index) -> json.readValue(row.getString("payload"),Analysis.class),workspaceId,id)
            .stream().findFirst().orElseThrow(() -> new ResourceNotFoundException("Source analysis was not found"));
    }
}
