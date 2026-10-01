package dev.researchhub.source.application;

import dev.researchhub.ai.application.EmbeddingBatch;
import dev.researchhub.ai.application.EmbeddingProvider;
import dev.researchhub.ai.application.RetrievalChunk;
import dev.researchhub.ai.application.RetrievalChunkSet;
import dev.researchhub.ai.application.RetrievalIndex;
import dev.researchhub.ai.application.RetrievalStore;
import dev.researchhub.processing.application.ProcessingJobNotification;
import dev.researchhub.processing.application.SourceExtraction;
import dev.researchhub.processing.application.SourceIngestResultSink;
import dev.researchhub.shared.error.ResourceNotFoundException;
import dev.researchhub.source.domain.SourceStatus;
import dev.researchhub.source.infrastructure.SourceRepository;
import dev.researchhub.source.infrastructure.SourceExtractionRepository;
import dev.researchhub.source.infrastructure.SourceVersionJobRepository;
import dev.researchhub.source.infrastructure.SourceVersionRepository;
import dev.researchhub.workspace.application.WorkspaceAuthorizationService;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Clock;
import java.util.UUID;

@Service
@Profile("local")
public class SourceExtractionService implements SourceIngestResultSink, SourceReadScope {
    private final SourceRepository sources;
    private final SourceExtractionRepository extractions;
    private final WorkspaceAuthorizationService authorization;
    private final Clock clock;
    private final RetrievalStore retrieval;
    private final EmbeddingProvider embeddings;
    private final RetrievalIndex index;
    private final SourceProcessingProgress progress;
    private final TransactionTemplate transactions;
    private final SourceVersionJobRepository versionJobs;
    private final SourceVersionRepository versions;
    public SourceExtractionService(SourceRepository sources, SourceExtractionRepository extractions,
                                   WorkspaceAuthorizationService authorization, Clock clock, RetrievalStore retrieval,
                                   EmbeddingProvider embeddings, RetrievalIndex index,
                                   SourceProcessingProgress progress, SourceVersionJobRepository versionJobs,
                                   SourceVersionRepository versions,
                                   PlatformTransactionManager transactionManager) {
        this.embeddings = embeddings;
        this.index = index;
        this.progress = progress;
        this.transactions = new TransactionTemplate(transactionManager);
        this.retrieval = retrieval;
        this.sources = sources;
        this.extractions = extractions;
        this.authorization = authorization;
        this.versionJobs = versionJobs;
        this.versions = versions;
        this.clock = clock;
    }
    @Override
    public void extracting(ProcessingJobNotification job) { progress.update(job, SourceProcessingProgress.Stage.EXTRACT); }
    @Override
    public void store(ProcessingJobNotification job, SourceExtraction extraction, RetrievalChunkSet chunks) {
        extraction.validate(job.resourceId());
        transactions.executeWithoutResult(_status -> requireCurrentInput(job, extraction));
        progress.update(job, SourceProcessingProgress.Stage.CHUNK);
        if (chunks == null) throw new IllegalArgumentException("Missing retrieval chunks");
        chunks.validate(job.workspaceId(), job.resourceId(), extraction);
        UUID sourceVersionId = versionJobs.findVersionId(job.jobId())
                .orElseThrow(() -> new IllegalStateException("Processing source version is not recorded"));
        chunks = chunks.withSourceVersion(sourceVersionId);
        progress.update(job, SourceProcessingProgress.Stage.EMBED);
        // Provider requests happen outside the database transaction and resource locks.
        var batch = embeddings.embedDocuments(chunks.chunks().stream().map(RetrievalChunk::content).toList());
        progress.update(job, SourceProcessingProgress.Stage.INDEX);
        RetrievalChunkSet versionedChunks = chunks;
        transactions.executeWithoutResult(_status -> persist(job, sourceVersionId, extraction, versionedChunks, batch));
        progress.update(job, SourceProcessingProgress.Stage.FINALIZE);
    }
    private void persist(ProcessingJobNotification job, UUID sourceVersionId, SourceExtraction extraction, RetrievalChunkSet chunks,
                         EmbeddingBatch batch) {
        requireCurrentInput(job, extraction);
        extractions.save(job.workspaceId(), job.resourceId(), sourceVersionId, job.jobId(), extraction, clock.instant());
        retrieval.save(job.jobId(), chunks, clock.instant());
        index.upsert(job.jobId(), chunks, batch);
    }
    private void requireCurrentInput(ProcessingJobNotification job, SourceExtraction extraction) {
        if (!extractions.lockCurrentAttempt(job.jobId(), job.workspaceId(), job.resourceId(), job.attemptCount())) {
            throw new IllegalStateException("Obsolete source extraction attempt");
        }
        var source = sources.findByWorkspaceIdAndIdForUpdate(job.workspaceId(), job.resourceId())
                .orElseThrow(() -> new IllegalStateException("Source for extraction is missing")).toDomain();
        if (!source.contentSha256().equals(extraction.extractionMetadata().contentSha256())) {
            throw new IllegalArgumentException("Extracted content hash differs from the uploaded source");
        }
    }
    @Override
    @Transactional(readOnly = true)
    public void requireSources(UUID workspaceId, UUID callerId, java.util.List<UUID> sourceIds) {
        authorization.requireContentReader(workspaceId, callerId);
        for (UUID sourceId : sourceIds) {
            if (sourceId == null || sources.findByWorkspaceIdAndId(workspaceId, sourceId).isEmpty()) {
                throw new ResourceNotFoundException(SourceService.SOURCE_NOT_FOUND);
            }
        }
    }
    @Override
    @Transactional(readOnly = true)
    public void requireSourceVersions(UUID workspaceId, UUID callerId, java.util.List<UUID> sourceVersionIds) {
        authorization.requireContentReader(workspaceId, callerId);
        if (sourceVersionIds == null || sourceVersionIds.stream().anyMatch(java.util.Objects::isNull)) {
            throw new ResourceNotFoundException(SourceService.SOURCE_NOT_FOUND);
        }
        for (UUID versionId : sourceVersionIds) {
            if (!versions.existsByWorkspaceIdAndId(workspaceId, versionId)) {
                throw new ResourceNotFoundException(SourceService.SOURCE_NOT_FOUND);
            }
        }
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

    /** Authorized historical extraction used by bounded dataset preview and reproducible analysis. */
    @Transactional(readOnly = true)
    public SourceExtraction findVersion(UUID workspaceId, UUID sourceId, UUID sourceVersionId, UUID callerId) {
        try {
            authorization.requireContentReader(workspaceId, callerId);
        } catch (ResourceNotFoundException hidden) {
            throw new ResourceNotFoundException(SourceService.SOURCE_NOT_FOUND);
        }
        if (sources.findByWorkspaceIdAndId(workspaceId, sourceId).isEmpty()) {
            throw new ResourceNotFoundException(SourceService.SOURCE_NOT_FOUND);
        }
        return extractions.findVersion(workspaceId, sourceId, sourceVersionId)
                .orElseThrow(() -> new ResourceNotFoundException(SourceService.SOURCE_NOT_FOUND));
    }

    /**
     * Authorized tabular profile of one archived version, or null when it has none. Used by the bounded dataset
     * preview, which needs the sheet/column metadata and never the extracted text.
     */
    @Transactional(readOnly = true)
    public SourceExtraction.WorkbookMetadata findVersionWorkbook(UUID workspaceId, UUID sourceId,
                                                                 UUID sourceVersionId, UUID callerId) {
        try {
            authorization.requireContentReader(workspaceId, callerId);
        } catch (ResourceNotFoundException hidden) {
            throw new ResourceNotFoundException(SourceService.SOURCE_NOT_FOUND);
        }
        if (sources.findByWorkspaceIdAndId(workspaceId, sourceId).isEmpty()) {
            throw new ResourceNotFoundException(SourceService.SOURCE_NOT_FOUND);
        }
        return extractions.findVersionWorkbook(workspaceId, sourceId, sourceVersionId).orElse(null);
    }
}
