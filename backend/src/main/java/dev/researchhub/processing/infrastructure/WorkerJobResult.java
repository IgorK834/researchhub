package dev.researchhub.processing.infrastructure;

import dev.researchhub.processing.domain.ProcessingJob;
import dev.researchhub.processing.domain.ProcessingJobError;

import java.util.List;
import java.util.UUID;

/** Untrusted worker result v1. Identity and collection limits are checked before a job can succeed. */
public record WorkerJobResult(
        String schemaVersion,
        UUID jobId,
        UUID workspaceId,
        UUID sourceId,
        String processingVersion,
        String status,
        boolean duplicateDelivery,
        ExtractionMetadata extractionMetadata,
        DocumentStructure structure,
        List<ExtractedChunk> chunks,
        List<String> warnings,
        Failure failure
) {
    static final int MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
    static final int MAX_PAGES = 10_000;
    static final int MAX_SECTIONS = 50_000;
    static final int MAX_CHUNKS = 100_000;
    static final int MAX_WARNINGS = 100;

    void validateFor(ProcessingJob job) {
        require(WorkerJobRequest.SCHEMA_VERSION.equals(schemaVersion), "schema version");
        require(job.id().equals(jobId), "job identity");
        require(job.workspaceId().equals(workspaceId), "workspace identity");
        require(job.resourceId().equals(sourceId), "source identity");
        require(WorkerJobRequest.PROCESSING_VERSION.equals(processingVersion), "processing version");
        require(structure != null && structure.pages() != null && structure.sections() != null,
                "document structure");
        require(chunks != null && warnings != null, "result collections");
        require(structure.pages().size() <= MAX_PAGES, "page count");
        require(structure.sections().size() <= MAX_SECTIONS, "section count");
        require(chunks.size() <= MAX_CHUNKS, "chunk count");
        require(warnings.size() <= MAX_WARNINGS, "warning count");
        require(warnings.stream().allMatch(warning -> warning != null && warning.length() <= 500),
                "warning size");

        if ("SUCCEEDED".equals(status)) {
            require(extractionMetadata != null && failure == null, "successful result state");
        } else if ("FAILED".equals(status)) {
            require(failure != null, "failed result state");
        } else {
            throw invalid("result status");
        }
    }

    ProcessingJobError safeFailure() {
        if (!"FAILED".equals(status) || failure == null) {
            return null;
        }
        try {
            return new ProcessingJobError(failure.code(), failure.message());
        } catch (IllegalArgumentException | NullPointerException invalid) {
            throw invalid("failure summary");
        }
    }

    private static void require(boolean condition, String field) {
        if (!condition) {
            throw invalid(field);
        }
    }

    private static IllegalArgumentException invalid(String field) {
        return new IllegalArgumentException("Worker result has an invalid " + field);
    }

    public record ExtractionMetadata(String title, String author, String language, long pageCount,
                                     long characterCount, String contentSha256) {
    }

    public record DocumentStructure(List<PageStructure> pages, List<SectionStructure> sections) {
    }

    public record PageStructure(int pageNumber, long characterStart, long characterEnd) {
    }

    public record SectionStructure(String sectionId, String heading, int level, String parentSectionId,
                                   long characterStart, long characterEnd) {
    }

    public record ExtractedChunk(String chunkId, int ordinal, String text, Integer pageNumber, String sectionId,
                                 long characterStart, long characterEnd) {
    }

    public record Failure(String code, String message) {
    }
}
