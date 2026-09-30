package dev.researchhub.processing.application;

/** Resource-owner port for validated output. Spring owns its durable storage. */
public interface SourceIngestResultSink {
    default void extracting(ProcessingJobNotification job) {}
    void store(ProcessingJobNotification job, SourceExtraction extraction, dev.researchhub.ai.application.RetrievalChunkSet retrieval);
}
