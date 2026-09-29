package dev.researchhub.source.application;

import dev.researchhub.processing.application.ProcessingFailure;
import dev.researchhub.processing.application.ProcessingJobNotification;
import dev.researchhub.processing.application.ProcessingJobStateListener;
import dev.researchhub.source.domain.Source;
import dev.researchhub.source.domain.SourceStatus;
import dev.researchhub.source.infrastructure.SourceEntity;
import dev.researchhub.source.infrastructure.SourceRepository;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;

/** Mirrors a SOURCE_INGEST job onto the source status shown to workspace members. */
@Component
@Profile("local")
public class SourceIngestJobStateListener implements ProcessingJobStateListener {

    private static final String SOURCE_INGEST = "SOURCE_INGEST";
    private static final String SOURCE = "SOURCE";

    private final SourceRepository sources;
    private final Clock clock;

    public SourceIngestJobStateListener(SourceRepository sources, Clock clock) {
        this.sources = sources;
        this.clock = clock;
    }

    @Override
    public boolean supports(ProcessingJobNotification job) {
        return SOURCE_INGEST.equals(job.jobType()) && SOURCE.equals(job.resourceType());
    }

    @Override
    @Transactional
    public void running(ProcessingJobNotification job) {
        Source source = require(job);
        if (source.status() == SourceStatus.UPLOADED || source.status() == SourceStatus.FAILED) {
            save(source.moveTo(SourceStatus.PROCESSING, clock.instant()));
        }
    }

    @Override
    @Transactional
    public void succeeded(ProcessingJobNotification job) {
        Source source = require(job);
        if (source.status() == SourceStatus.PROCESSING) {
            save(source.moveTo(SourceStatus.READY, clock.instant()));
        }
    }

    @Override
    @Transactional
    public void failed(ProcessingJobNotification job, ProcessingFailure error) {
        Source source = require(job);
        // A backend can stop after the database claim and before the RUNNING callback commits. With a one-attempt
        // policy, stale recovery then delivers terminal failure while the source is still UPLOADED. Move through the
        // legal lifecycle inside this transaction so the UI cannot remain stuck behind a terminal job.
        if (source.status() == SourceStatus.UPLOADED) {
            source = source.moveTo(SourceStatus.PROCESSING, clock.instant());
        }
        if (source.status() == SourceStatus.PROCESSING) {
            save(source.processingFailed(error.message(), clock.instant()));
        }
    }

    private Source require(ProcessingJobNotification job) {
        return sources.findByWorkspaceIdAndIdForUpdate(job.workspaceId(), job.resourceId())
                .map(SourceEntity::toDomain)
                .orElseThrow(() -> new IllegalStateException(
                        "source for processing job " + job.jobId() + " is missing"));
    }

    private void save(Source source) {
        sources.saveAndFlush(SourceEntity.fromDomain(source));
    }
}
