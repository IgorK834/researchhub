package dev.researchhub.ai.application;

import dev.researchhub.source.application.SourceExtractionService;
import dev.researchhub.source.application.SourceService;
import dev.researchhub.shared.error.ResourceNotFoundException;
import dev.researchhub.shared.error.ConflictException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.util.UUID;

@Service
public class SourceRetrievalService {
    private final SourceExtractionService extractions;
    private final RetrievalStore retrieval;
    public SourceRetrievalService(SourceExtractionService extractions, RetrievalStore retrieval) { this.extractions = extractions; this.retrieval = retrieval; }
    @Transactional(readOnly = true, isolation = org.springframework.transaction.annotation.Isolation.REPEATABLE_READ)
    public RetrievalChunkSet find(UUID workspaceId, UUID sourceId, UUID callerId, String processingVersion) {
        // The source module owns authorization and READY publication; no unscoped read is exposed.
        var extraction = extractions.find(workspaceId, sourceId, callerId);
        if (extraction == null) return null;
        var set = retrieval.find(workspaceId, sourceId, extraction).orElse(null);
        if (set != null && processingVersion != null && !processingVersion.equals(set.processingVersion())) {
            throw new ConflictException("The source retrieval version has changed; refresh its chunks");
        }
        return set;
    }
    @Transactional(readOnly = true, isolation = org.springframework.transaction.annotation.Isolation.REPEATABLE_READ)
    public RetrievalChunk chunk(UUID workspaceId, UUID sourceId, UUID callerId, String chunkId, String processingVersion) {
        var set = find(workspaceId, sourceId, callerId, processingVersion);
        if (set == null) throw new ResourceNotFoundException(SourceService.SOURCE_NOT_FOUND);
        return set.chunks().stream().filter(chunk -> chunk.chunkId().equals(chunkId)).findFirst()
                .orElseThrow(() -> new ResourceNotFoundException(SourceService.SOURCE_NOT_FOUND));
    }

    /** Resolves immutable historical evidence for an analysis that explicitly keeps its original inputs. */
    @Transactional(readOnly = true, isolation = org.springframework.transaction.annotation.Isolation.REPEATABLE_READ)
    public RetrievalChunk chunk(UUID workspaceId, UUID sourceId, UUID sourceVersionId, UUID callerId,
                                String chunkId, String processingVersion) {
        if (sourceVersionId == null) return chunk(workspaceId, sourceId, callerId, chunkId, processingVersion);
        extractions.findVersion(workspaceId, sourceId, sourceVersionId, callerId);
        var set = retrieval.findVersion(workspaceId, sourceId, sourceVersionId)
                .orElseThrow(() -> new ResourceNotFoundException(SourceService.SOURCE_NOT_FOUND));
        if (!processingVersion.equals(set.processingVersion())) {
            throw new ConflictException("The requested source version has different retrieval provenance");
        }
        return set.chunks().stream().filter(value -> chunkId.equals(value.chunkId())).findFirst()
                .orElseThrow(() -> new ResourceNotFoundException(SourceService.SOURCE_NOT_FOUND));
    }
}
