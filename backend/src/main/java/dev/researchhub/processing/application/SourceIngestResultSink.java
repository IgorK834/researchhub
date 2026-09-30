package dev.researchhub.processing.application;

/** Resource-owner port for validated output. Spring owns its durable storage. */
public interface SourceIngestResultSink {
    void store(ProcessingJobNotification job, SourceExtraction extraction);
}
