package dev.researchhub.processing.infrastructure;

import dev.researchhub.processing.application.SourceIngestInput;
import dev.researchhub.processing.domain.ProcessingJob;

import java.net.URI;
import java.time.Instant;
import java.util.UUID;

/** Versioned internal request. It contains no user token, cookie, storage key, or file bytes. */
public record WorkerJobRequest(
        String schemaVersion,
        UUID jobId,
        UUID workspaceId,
        UUID sourceId,
        String sourceType,
        TemporaryFileAccess fileAccess,
        String requestedProcessingVersion,
        int attempt
) {
    static final String SCHEMA_VERSION = "1.0";
    static final String PROCESSING_VERSION = "source-ingest-1";

    static WorkerJobRequest from(ProcessingJob job, SourceIngestInput input) {
        return new WorkerJobRequest(SCHEMA_VERSION, job.id(), job.workspaceId(), job.resourceId(), input.sourceType(),
                new TemporaryFileAccess("SIGNED_URL", input.signedReadUrl(), input.expiresAt()),
                PROCESSING_VERSION, job.attemptCount());
    }

    public record TemporaryFileAccess(String kind, URI url, Instant expiresAt) {
    }
}
