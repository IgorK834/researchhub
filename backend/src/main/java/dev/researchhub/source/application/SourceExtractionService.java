package dev.researchhub.source.application;

import dev.researchhub.processing.application.ProcessingJobNotification;
import dev.researchhub.processing.application.SourceExtraction;
import dev.researchhub.processing.application.SourceIngestResultSink;
import dev.researchhub.shared.error.ResourceNotFoundException;
import dev.researchhub.source.domain.SourceStatus;
import dev.researchhub.source.infrastructure.SourceRepository;
import dev.researchhub.source.infrastructure.SourceExtractionRepository;
import dev.researchhub.workspace.application.WorkspaceAuthorizationService;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.util.UUID;

@Service
@Profile("local")
public class SourceExtractionService implements SourceIngestResultSink {
    private final SourceRepository sources;
    private final SourceExtractionRepository extractions;
    private final WorkspaceAuthorizationService authorization;
    private final Clock clock;
    public SourceExtractionService(SourceRepository sources, SourceExtractionRepository extractions,
                                   WorkspaceAuthorizationService authorization, Clock clock) {
        this.sources = sources; this.extractions = extractions; this.authorization = authorization; this.clock = clock;
    }
    @Override
    @Transactional
    public void store(ProcessingJobNotification job, SourceExtraction extraction) {
        extraction.validate(job.resourceId());
        if (!extractions.lockCurrentAttempt(job.jobId(), job.workspaceId(), job.resourceId(), job.attemptCount())) {
            throw new IllegalStateException("Obsolete source extraction attempt");
        }
        var source = sources.findByWorkspaceIdAndIdForUpdate(job.workspaceId(), job.resourceId())
                .orElseThrow(() -> new IllegalStateException("Source for extraction is missing")).toDomain();
        if (!source.contentSha256().equals(extraction.extractionMetadata().contentSha256())) {
            throw new IllegalArgumentException("Extracted content hash differs from the uploaded source");
        }
        extractions.save(job.workspaceId(), job.resourceId(), job.jobId(), extraction, clock.instant());
    }
    @Transactional(readOnly = true)
    public SourceExtraction find(UUID workspaceId, UUID sourceId, UUID callerId) {
        try {
            authorization.requireContentReader(workspaceId, callerId);
        } catch (ResourceNotFoundException hidden) {
            throw new ResourceNotFoundException(SourceService.SOURCE_NOT_FOUND);
        }
        var source = sources.findByWorkspaceIdAndId(workspaceId, sourceId)
                .orElseThrow(() -> new ResourceNotFoundException(SourceService.SOURCE_NOT_FOUND)).toDomain();
        // A stored result is published only after the source has completed successfully.
        if (source.status() != SourceStatus.READY) return null;
        return extractions.find(workspaceId, sourceId).orElse(null);
    }
}
