package dev.researchhub.processing.application;

import dev.researchhub.processing.domain.ProcessingJob;
import dev.researchhub.processing.domain.ProcessingJobType;
import dev.researchhub.processing.domain.ProcessingResourceType;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.util.UUID;

/** Creates idempotent durable processing work inside the caller's database transaction. */
@Service
@Profile("local")
public class ProcessingJobService {

    private final ProcessingJobQueue queue;
    private final Clock clock;

    public ProcessingJobService(ProcessingJobQueue queue, Clock clock) {
        this.queue = queue;
        this.clock = clock;
    }

    /**
     * Returns the one SOURCE_INGEST job for this immutable source, creating it if necessary.
     * The database unique key makes concurrent duplicate enqueue requests converge on the same row.
     */
    @Transactional
    public ProcessingJob enqueueSourceIngest(UUID workspaceId, UUID sourceId) {
        ProcessingJob pending = ProcessingJob.pending(workspaceId, ProcessingJobType.SOURCE_INGEST,
                ProcessingResourceType.SOURCE, sourceId, clock.instant());
        return queue.insertIfAbsent(pending);
    }
}
