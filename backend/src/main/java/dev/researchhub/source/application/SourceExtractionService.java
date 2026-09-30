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
    private final dev.researchhub.ai.application.RetrievalStore retrieval;
    public SourceExtractionService(SourceRepository sources, SourceExtractionRepository extractions,
                                   WorkspaceAuthorizationService authorization, Clock clock, dev.researchhub.ai.application.RetrievalStore retrieval) {
        this.retrieval = retrieval; this.sources = sources; this.extractions = extractions; this.authorization = authorization; this.clock = clock;
    }
    @Override
    @Transactional
    public void store(ProcessingJobNotification job, SourceExtraction extraction, dev.researchhub.ai.application.RetrievalChunkSet chunks) {
        extraction.validate(job.resourceId());
        if (!extractions.lockCurrentAttempt(job.jobId(), job.workspaceId(), job.resourceId(), job.attemptCount())) {
            throw new IllegalStateException("Obsolete source extraction attempt");
        }
        var source = sources.findByWorkspaceIdAndIdForUpdate(job.workspaceId(), job.resourceId())
                .orElseThrow(() -> new IllegalStateException("Source for extraction is missing")).toDomain();
        if (!source.contentSha256().equals(extraction.extractionMetadata().contentSha256())) {
            throw new IllegalArgumentException("Extracted content hash differs from the uploaded source");
        }
        if (chunks == null) throw new IllegalArgumentException("Missing retrieval chunks");
        chunks.validate(job.workspaceId(), job.resourceId(), extraction);
        extractions.save(job.workspaceId(), job.resourceId(), job.jobId(), extraction, clock.instant());
        retrieval.save(job.jobId(), chunks, clock.instant());
    }
    @Transactional(readOnly = true)
    public java.util.List<ExtractionRun> runs(UUID workspaceId, UUID sourceId, UUID callerId) {
        // Authorization applies even while the current run is not READY.
        find(workspaceId, sourceId, callerId);
        return extractions.runs(workspaceId, sourceId);
    }

    @Transactional(readOnly = true)
    public SourceLocation location(UUID workspaceId, UUID sourceId, UUID callerId, String unitId, Integer pageNumber) {
        SourceExtraction extraction = find(workspaceId, sourceId, callerId);
        if (extraction == null) throw new ResourceNotFoundException(SourceService.SOURCE_NOT_FOUND);
        var unit = extraction.chunks().stream()
                .filter(chunk -> unitId != null ? unitId.equals(chunk.chunkId()) : pageNumber != null && pageNumber.equals(chunk.pageNumber()))
                .findFirst().orElseThrow(() -> new ResourceNotFoundException(SourceService.SOURCE_NOT_FOUND));
        java.util.function.Function<String, String> encode = value -> java.net.URLEncoder.encode(value, java.nio.charset.StandardCharsets.UTF_8);
        String sourceLink = "/app/workspaces/" + workspaceId + "/sources/" + sourceId
                + "?unit=" + encode.apply(unit.chunkId()) + "&parserVersion=" + encode.apply(extraction.parserVersion());
        if (unit.pageNumber() != null) sourceLink += "&page=" + unit.pageNumber();
        if (unit.location() != null && unit.location().sheetName() != null) sourceLink += "&sheet=" + encode.apply(unit.location().sheetName());
        String preview = unit.pageNumber() == null ? null : "/api/workspaces/" + workspaceId + "/sources/" + sourceId + "/preview#page=" + unit.pageNumber();
        return new SourceLocation(workspaceId, sourceId, unit.chunkId(), unit.pageNumber(), unit.characterStart(),
                unit.characterEnd(), unit.location(), extraction.parserVersion(), extraction.processingVersion(),
                extraction.extractionMetadata().contentSha256(), sourceLink, preview);
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
