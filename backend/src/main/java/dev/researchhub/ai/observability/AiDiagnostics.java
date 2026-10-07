package dev.researchhub.ai.observability;

import dev.researchhub.ai.application.*;
import dev.researchhub.ai.application.GenerationContracts.*;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.*;

/** Explicit diagnostics contract. Usage rows contain metadata only; content capture is independent. */
public final class AiDiagnostics {
    private AiDiagnostics() {}
    public enum Feature { ASK_WORKSPACE, SECTION_GENERATION, REWRITE, EVIDENCE_SEARCH, SOURCE_ANALYSIS, ANALYSIS_PLANNING, GROUNDED_RESPONSE }
    public record ProviderUsage(ModelMetadata model, Usage usage) {}
    public record Cost(BigDecimal usd, String pricingVersion, boolean estimated) {}
    public record UsageEvent(UUID requestId, UUID workspaceId, String correlationId, Feature feature,
        String templateId, String templateHash, ModelMetadata model, Usage usage, long latencyMs,
        Cost cost, String status, String errorCode, Instant startedAt) {}
    public record Aggregate(Feature feature, String provider, String model, String modelVersion, String templateId,
        String status, long requests, long usageKnown, long estimatedUsageRequests, Long inputTokens, Long outputTokens,
        long costKnown, BigDecimal estimatedCostUsd, double averageLatencyMs) {}
    public record Hit(Citation citation, double score, double vectorSimilarity, double lexicalScore,
        EmbeddingModel embeddingModel, int contentBytes) {}
    public record Chunk(Hit hit, String text, String availability, String citationKey, String textReference) {}
    public record Trace(UUID id, UUID workspaceId, String correlationId, Instant startedAt, String query,
        List<UUID> selectedSourceIds, List<dev.researchhub.analysis.application.AnalysisEvidenceService.Reference> selectedAnalysisOutputs,
        int topK, Parameters parameters, String templateId, String templateHash, String status, String errorCode,
        Long retrievalLatencyMs, List<Hit> hits, UUID generationRequestId, ContextContracts.Summary context,
        QuestionContracts.Response response) {}
    public record TraceSummary(UUID id, String correlationId, Instant startedAt, String status, String errorCode,
        UUID generationRequestId, String query, int retrievedChunks) {}
    public record Detail(Trace trace, UsageEvent usage, List<Chunk> chunks, String retrievalStrategy, String reranking) {}
    public record Overview(int days, boolean contentCaptureEnabled, List<Aggregate> usage, List<TraceSummary> traces) {}
}
