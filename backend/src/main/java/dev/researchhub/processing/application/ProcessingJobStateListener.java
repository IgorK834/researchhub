package dev.researchhub.processing.application;

/** Lets a resource-owning module mirror processing state without putting its domain inside processing. */
public interface ProcessingJobStateListener {

    boolean supports(ProcessingJobNotification job);

    void running(ProcessingJobNotification job);

    void succeeded(ProcessingJobNotification job);

    void failed(ProcessingJobNotification job, ProcessingFailure error);
}
