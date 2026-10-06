package dev.researchhub.document.application;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Profile;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import java.time.*;
import java.util.UUID;

@Component
@Profile("local")
@ConditionalOnProperty(name="researchhub.documents.history.scheduler.enabled",havingValue="true",matchIfMissing=true)
public class DocumentSnapshotScheduler {
    private final DocumentService documents;
    private final JdbcTemplate jdbc;
    private final Clock clock;
    private final Duration interval;
    public DocumentSnapshotScheduler(DocumentService documents,JdbcTemplate jdbc,Clock clock,
            @Value("${researchhub.documents.history.autosave-checkpoint-interval:PT10M}") Duration interval) {
        if (interval.isNegative() || interval.isZero()) throw new IllegalArgumentException("Snapshot interval must be positive");
        this.documents=documents; this.jdbc=jdbc; this.clock=clock; this.interval=interval;
    }
    @Scheduled(initialDelayString="${researchhub.documents.history.scheduler.fixed-delay:PT1M}",fixedDelayString="${researchhub.documents.history.scheduler.fixed-delay:PT1M}")
    public void checkpoint() {
        record Candidate(UUID workspace,UUID document) {}
        var candidates=jdbc.query("SELECT d.workspace_id,d.id FROM documents d WHERE d.archived_at IS NULL AND NOT EXISTS (SELECT 1 FROM document_versions v WHERE v.document_id=d.id AND (v.revision=d.revision OR v.created_at>?)) ORDER BY d.updated_at LIMIT 100",
                (r,i) -> new Candidate(r.getObject(1,UUID.class),r.getObject(2,UUID.class)),java.sql.Timestamp.from(clock.instant().minus(interval)));
        for (var candidate:candidates) {
            try { documents.scheduledSnapshot(candidate.workspace(),candidate.document(),clock.instant().minus(interval)); }
            catch(RuntimeException failure) { org.slf4j.LoggerFactory.getLogger(getClass()).warn("event=document.snapshot.schedule.failed documentId={}",candidate.document(),failure); }
        }
    }
}
