package dev.researchhub.source.application;

import dev.researchhub.ai.application.RetrievalIndex;
import dev.researchhub.ai.application.RetrievalStore;
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
import dev.researchhub.processing.application.ProcessingJobQueue;
import dev.researchhub.processing.domain.ProcessingJobType;
import dev.researchhub.processing.domain.ProcessingResourceType;
import dev.researchhub.source.infrastructure.SourceExtractionRepository;

/** Mirrors a SOURCE_INGEST job onto the source status shown to workspace members. */
@Component
@Profile("local")
public class SourceIngestJobStateListener implements ProcessingJobStateListener {

    private static final String SOURCE_INGEST = "SOURCE_INGEST";
    private static final String SOURCE = "SOURCE";

    private final SourceRepository sources;
    private final Clock clock;
    private final SourceExtractionRepository extractions;
    private final ProcessingJobQueue queue;
    private final RetrievalStore retrieval;
    private final RetrievalIndex index;

    public SourceIngestJobStateListener(SourceRepository sources, Clock clock, SourceExtractionRepository extractions, ProcessingJobQueue queue, RetrievalStore retrieval, RetrievalIndex index) {
        this.index = index;
        this.retrieval = retrieval;
        this.extractions = extractions;
        this.queue = queue;
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
        if (!current(job)) return;
        if (source.status() == SourceStatus.UPLOADED || source.status() == SourceStatus.FAILED) {
            save(source.moveTo(SourceStatus.PROCESSING, clock.instant()));
        }
    }

    @Override
    @Transactional
    public void succeeded(ProcessingJobNotification job) {
        Source source = require(job);
        if (!current(job)) return;
        if (source.status() == SourceStatus.PROCESSING) {
            if (!extractions.existsForJob(job.workspaceId(), job.resourceId(), job.jobId())
                    || !retrieval.existsForJob(job.workspaceId(), job.resourceId(), job.jobId())
                    || !index.existsForJob(job.workspaceId(), job.resourceId(), job.jobId())) {
                throw new IllegalStateException("A source cannot be READY without its persisted processing result");
            }
            save(source.moveTo(SourceStatus.READY, clock.instant()));
        }
    }

    @Override
    @Transactional
    public void failed(ProcessingJobNotification job, ProcessingFailure error) {
        Source source = require(job);
        if (!current(job)) return;
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

    private boolean current(ProcessingJobNotification job) {
        return queue.findByResource(ProcessingJobType.SOURCE_INGEST, ProcessingResourceType.SOURCE, job.resourceId())
                .map(latest -> latest.id().equals(job.jobId())).orElse(false);
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
