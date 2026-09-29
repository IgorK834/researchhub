package dev.researchhub.processing.application;

import dev.researchhub.processing.domain.ProcessingJob;

/** Internal delivery port. Implementations must never forward an end-user session or authorization token. */
public interface ProcessingWorkerClient {
    void execute(ProcessingJob job);
}
