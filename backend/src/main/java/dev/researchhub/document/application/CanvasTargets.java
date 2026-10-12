package dev.researchhub.document.application;

import java.util.List;
import java.util.UUID;

/** Document-owned target types shared through application ports; offsets are UTF-16 units. */
public final class CanvasTargets {
    private CanvasTargets() {}
    public enum Kind { CARET, TEXT, ANALYSIS, SOURCE }
    public record Endpoint(String blockId, List<Integer> path, int offset) {}
    public record Target(Kind kind, Endpoint start, Endpoint end, String hash) {}
    public record Relative(String start, String end) {}
    public record SourceReference(UUID sourceId, UUID sourceVersionId, String chunkId, String processingVersion) {}
    public record AnalysisReference(UUID analysisId, UUID executionId, String outputId) {}
    public record Snapshot(Target target, String text, String before, String after,
                           List<SourceReference> sources, List<AnalysisReference> analyses,@com.fasterxml.jackson.annotation.JsonInclude(com.fasterxml.jackson.annotation.JsonInclude.Include.NON_EMPTY) List<tools.jackson.databind.JsonNode> formulas) {
        public Snapshot {formulas=formulas==null?List.of():formulas.stream().map(tools.jackson.databind.JsonNode::deepCopy).toList();}
        public Snapshot(Target target,String text,String before,String after,List<SourceReference> sources,List<AnalysisReference> analyses){this(target,text,before,after,sources,analyses,List.of());}
    }
    public record Resolution(Endpoint start, Endpoint end, Relative relative) {
        public Resolution(Endpoint start, Endpoint end) { this(start,end,null); }
    }
}
