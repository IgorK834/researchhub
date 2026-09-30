package dev.researchhub.source.application;

import dev.researchhub.processing.application.ProcessingJobNotification;
import dev.researchhub.source.infrastructure.SourceRepository;
import dev.researchhub.shared.error.ResourceNotFoundException;
import dev.researchhub.workspace.application.WorkspaceAuthorizationService;
import org.springframework.context.annotation.Profile;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.annotation.Propagation;
import java.util.UUID;

@Service
@Profile("local")
public class SourceProcessingProgress {
    public enum Stage {
        EXTRACT(10), CHUNK(30), EMBED(50), INDEX(75), FINALIZE(90);
        final int percent;
        Stage(int percent) { this.percent = percent; }
    }
    public record Progress(UUID jobId, String status, Stage stage, int progress, int attempt) {}
    private final JdbcTemplate jdbc;
    private final SourceRepository sources;
    private final WorkspaceAuthorizationService authorization;
    public SourceProcessingProgress(JdbcTemplate jdbc, SourceRepository sources, WorkspaceAuthorizationService authorization) {
        this.jdbc = jdbc; this.sources = sources; this.authorization = authorization;
    }
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void update(ProcessingJobNotification job, Stage stage) {
        jdbc.update("UPDATE processing_jobs SET stage=? WHERE id=? AND workspace_id=? AND resource_id=? AND attempt_count=? AND status='RUNNING'",
            stage.name(),job.jobId(),job.workspaceId(),job.resourceId(),job.attemptCount());
    }
    @Transactional(readOnly = true)
    public Progress find(UUID workspaceId, UUID sourceId, UUID callerId) {
        authorization.requireContentReader(workspaceId,callerId);
        if (sources.findByWorkspaceIdAndId(workspaceId,sourceId).isEmpty()) throw new ResourceNotFoundException(SourceService.SOURCE_NOT_FOUND);
        return jdbc.query("""
            SELECT id,status,stage,attempt_count FROM processing_jobs WHERE workspace_id=? AND resource_id=?
            AND job_type='SOURCE_INGEST' AND resource_type='SOURCE' ORDER BY generation DESC LIMIT 1
            """, (row,_i) -> {
                String status = row.getString("status");
                Stage stage = row.getString("stage") == null ? null : Stage.valueOf(row.getString("stage"));
                int percent = "SUCCEEDED".equals(status) ? 100 : "PENDING".equals(status) ? 0 : stage == null ? 0 : stage.percent;
                return new Progress(row.getObject("id",UUID.class),status,stage,percent,row.getInt("attempt_count"));
            },workspaceId,sourceId).stream().findFirst().orElse(null);
    }
}
