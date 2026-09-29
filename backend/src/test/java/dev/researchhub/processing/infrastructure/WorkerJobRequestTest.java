package dev.researchhub.processing.infrastructure;

import dev.researchhub.processing.domain.ProcessingJob;
import dev.researchhub.processing.domain.ProcessingJobType;
import dev.researchhub.processing.domain.ProcessingResourceType;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;

class WorkerJobRequestTest {

    @Test
    void exposesOnlyTheInternalProcessingContract() {
        UUID workspaceId = UUID.randomUUID();
        UUID sourceId = UUID.randomUUID();
        ProcessingJob running = ProcessingJob.pending(workspaceId, ProcessingJobType.SOURCE_INGEST,
                ProcessingResourceType.SOURCE, sourceId, Instant.EPOCH).start(Instant.EPOCH.plusSeconds(1), 3);

        WorkerJobRequest request = WorkerJobRequest.from(running);

        assertEquals(running.id(), request.jobId());
        assertEquals(workspaceId, request.workspaceId());
        assertEquals("SOURCE_INGEST", request.jobType());
        assertEquals("SOURCE", request.resourceType());
        assertEquals(sourceId, request.resourceId());
        assertEquals(1, request.attempt());
    }
}
