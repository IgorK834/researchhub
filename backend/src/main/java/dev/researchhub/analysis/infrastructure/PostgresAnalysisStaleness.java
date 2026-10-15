package dev.researchhub.analysis.infrastructure;

import dev.researchhub.analysis.application.AnalysisStaleness;
import dev.researchhub.analysis.application.AnalysisStaleness.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import java.util.*;

@Repository
public class PostgresAnalysisStaleness {
    private final JdbcTemplate jdbc;
    public PostgresAnalysisStaleness(JdbcTemplate jdbc){this.jdbc=jdbc;}
    public AnalysisStaleness assess(UUID workspace,UUID analysis) {
        var changed=jdbc.query("""
            SELECT i.source_id,v.id AS original_id,v.version_number AS original_number,v.content_sha256 AS original_hash,
            c.id AS active_version_id,s.active_version_number,c.content_sha256 AS current_hash,w.archived_at
            FROM analysis_inputs i LEFT JOIN source_versions v ON v.id=i.source_version_id AND v.workspace_id=i.workspace_id
            LEFT JOIN sources s ON s.id=i.source_id AND s.workspace_id=i.workspace_id
            LEFT JOIN source_versions c ON c.id=s.active_version_id AND c.workspace_id=i.workspace_id
            JOIN workspaces w ON w.id=i.workspace_id
            WHERE i.workspace_id=? AND i.analysis_id=? AND
             (v.id IS NULL OR c.id IS NULL OR v.id<>c.id OR v.content_sha256<>c.content_sha256 OR w.archived_at IS NOT NULL)
            ORDER BY i.ordinal LIMIT 5
            """,(r,i)->{
                UUID original=r.getObject("original_id",UUID.class),current=r.getObject("active_version_id",UUID.class);
                String reason=original==null||current==null?"INPUT_UNAVAILABLE":r.getTimestamp("archived_at")!=null?"WORKSPACE_ARCHIVED":"SOURCE_REPLACED";
                return new ChangedInput(r.getObject("source_id",UUID.class),original==null?null:new Version(original,r.getInt("original_number"),r.getString("original_hash")),
                    current==null?null:new Version(current,r.getInt("active_version_number"),r.getString("current_hash")),reason);
            },workspace,analysis);
        return new AnalysisStaleness(!changed.isEmpty(),changed.stream().map(ChangedInput::reason).distinct().toList(),changed);
    }
}
