package dev.researchhub.ai.application;

import java.util.*;

/** Explicit model gateway v1 wire contract. Providers receive text, never storage capabilities. */
public final class GenerationContracts {
    private GenerationContracts() {}

    public record ModelMetadata(String provider, String name, String version, boolean structuredOutput, boolean streaming) {
        public ModelMetadata {
            identifier(provider); identifier(name); identifier(version);
            require(structuredOutput && !streaming);
        }
    }
    public record Parameters(Double temperature, int maxOutputTokens) {
        public Parameters {
            require(temperature == null || Double.isFinite(temperature) && temperature >= 0 && temperature <= 2);
            require(maxOutputTokens >= 16 && maxOutputTokens <= 8192);
        }
    }
    public record Evidence(String chunkId, String contentHash, String content) {
        public Evidence {
            hash(chunkId); hash(contentHash); text(content, 8000);
            require(RetrievalIdentity.hash(content).equals(contentHash));
        }
    }
    public record Request(String schemaVersion, UUID requestId, String templateId, String templateHash,
                          String systemInstruction, String instruction, Parameters parameters, List<Evidence> evidence) {
        public Request {
            require("1.0".equals(schemaVersion) && requestId != null && parameters != null);
            identifier(templateId); hash(templateHash); text(systemInstruction, 4000); text(instruction, 4000);
            require(RetrievalIdentity.hash(systemInstruction).equals(templateHash));
            evidence = bounded(evidence, 12);
            require(evidence.stream().map(Evidence::chunkId).distinct().count() == evidence.size());
        }
    }
    public record Claim(String text, List<String> evidenceIds) {
        public Claim {
            GenerationContracts.text(text, 2000); evidenceIds = bounded(evidenceIds, 12);
            require(!evidenceIds.isEmpty() && evidenceIds.stream().distinct().count() == evidenceIds.size());
            evidenceIds.forEach(GenerationContracts::hash);
        }
    }
    public record Answer(String status, List<Claim> claims) {
        public Answer {
            claims = bounded(claims, 12);
            require("SUPPORTED".equals(status) && !claims.isEmpty() || "INSUFFICIENT_EVIDENCE".equals(status) && claims.isEmpty());
        }
    }
    public record Usage(long inputTokens, long outputTokens, long totalTokens, boolean estimated) {
        public Usage {
            require(inputTokens >= 0 && inputTokens <= 20_000_000 && outputTokens >= 0 && outputTokens <= 20_000_000);
            require(totalTokens == inputTokens + outputTokens);
        }
    }
    public record Result(String schemaVersion, UUID requestId, String templateId, String templateHash,
                         ModelMetadata model, Usage usage, String providerRequestId, Answer answer) {
        public Result {
            require("1.0".equals(schemaVersion) && requestId != null && model != null && usage != null && answer != null);
            identifier(templateId); hash(templateHash); identifier(providerRequestId);
        }
        public void validateFor(Request request) {
            require(requestId.equals(request.requestId()) && templateId.equals(request.templateId()) && templateHash.equals(request.templateHash()));
            var ids = request.evidence().stream().map(Evidence::chunkId).collect(java.util.stream.Collectors.toSet());
            require(answer.claims().stream().allMatch(claim -> ids.containsAll(claim.evidenceIds())));
        }
    }
    public record Citation(String chunkId, UUID workspaceId, UUID sourceId, UUID sourceVersionId,
                           String processingVersion, String contentHash, Integer pageStart, Integer pageEnd,
                           String sectionTitle, List<SourceSpan> spans, String title) {
        public static Citation from(RetrievalChunk chunk) {
            return from(chunk, null);
        }
        public static Citation from(RetrievalChunk chunk, String title) {
            return new Citation(chunk.chunkId(), chunk.workspaceId(), chunk.sourceId(), chunk.sourceVersionId(),
                chunk.processingVersion(), chunk.contentHash(), chunk.pageStart(), chunk.pageEnd(), chunk.sectionTitle(), List.copyOf(chunk.spans()), title);
        }
    }
    /** Provenance is assembled by the application, never supplied by the model. */
    public record GeneratedResponse(Result result, List<Citation> evidence, ContextContracts.Summary context,
        @com.fasterxml.jackson.annotation.JsonInclude(com.fasterxml.jackson.annotation.JsonInclude.Include.NON_EMPTY)
        List<dev.researchhub.analysis.application.AnalysisEvidenceService.Citation> analysisEvidence) {
        public GeneratedResponse { Objects.requireNonNull(result); evidence = bounded(evidence, 12);analysisEvidence=bounded(analysisEvidence==null ? List.of() : analysisEvidence,6);require(evidence.size()+analysisEvidence.size()<=12); }
        public GeneratedResponse(Result result, List<Citation> evidence, ContextContracts.Summary context) { this(result,evidence,context,List.of()); }
        public GeneratedResponse(Result result, List<Citation> evidence) { this(result, evidence, null,List.of()); }
    }
    public record EvidenceReference(UUID sourceId, String chunkId, String processingVersion) {
        public EvidenceReference { require(sourceId != null); hash(chunkId); identifier(processingVersion); }
    }
    public record Command(String instruction, List<EvidenceReference> evidence) {
        public Command { text(instruction, 4000); evidence = bounded(evidence, 12); require(new HashSet<>(evidence).size() == evidence.size()); }
    }
    static void identifier(String value) { text(value, 128); require(value.equals(value.strip())); }
    static void hash(String value) { require(value != null && value.matches("[0-9a-f]{64}")); }
    static void text(String value, int maximum) { require(value != null && !value.isBlank() && value.codePointCount(0, value.length()) <= maximum); }
    static <T> List<T> bounded(List<T> values, int maximum) { require(values != null && values.size() <= maximum); return List.copyOf(values); }
    static void require(boolean valid) { if (!valid) throw new IllegalArgumentException("Invalid model gateway contract"); }
}
