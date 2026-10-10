package dev.researchhub.document.application;

import dev.researchhub.document.application.CanvasTargets.*;
import dev.researchhub.shared.error.*;
import tools.jackson.databind.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;

/** Pure projection over saved editor JSON. Inline atoms occupy one UTF-16 offset, like ProseMirror. */
public final class CanvasDocumentTarget {
    public static final int SELECTED_MAX = 4000, SURROUNDING_MAX = 512, SNAPSHOT_MAX_BYTES = 24576;
    private record Block(JsonNode node, List<Integer> path, String id, String text) {}
    private final ObjectMapper json;
    public CanvasDocumentTarget(ObjectMapper json) { this.json = json; }
    public Snapshot capture(String content, Target target) {
        if (target == null || target.kind() == null || target.start() == null || target.end() == null
                || target.hash() == null || !target.hash().matches("[a-f0-9]{64}")) throw invalid();
        var blocks = new ArrayList<Block>();
        var root = json.readTree(content);
        if (!"doc".equals(root.path("type").asString())) throw invalid();
        walk(root, List.of(), blocks, 0);
        Block first = find(blocks, target.start()), last = find(blocks, target.end());
        int a = blocks.indexOf(first), b = blocks.indexOf(last);
        if (a > b || (a == b && target.start().offset() > target.end().offset())) throw invalid();
        String text, before = "", after = "";
        var sources = new ArrayList<SourceReference>(); var analyses = new ArrayList<AnalysisReference>();
        if (target.kind() == Kind.ANALYSIS) {
            if (first != last || !"analysisResult".equals(first.node().path("type").asString())
                    || target.start().offset() != 0 || target.end().offset() != 1) throw invalid();
            var ref = first.node().path("attrs").path("reference");
            analyses.add(new AnalysisReference(uuid(ref.path("analysisId")), uuid(ref.path("executionId")), ref.path("outputId").asString()));
            text = analyses.getFirst().analysisId()+":"+analyses.getFirst().executionId()+":"+analyses.getFirst().outputId();
        } else {
            if (blocks.subList(a,b+1).stream().anyMatch(block -> "analysisResult".equals(block.node().path("type").asString()))) throw invalid();
            int from = target.start().offset(), to = target.end().offset();
            if (target.kind() == Kind.CARET && (first != last || from != to)) throw invalid();
            if (target.kind() != Kind.CARET && a == b && from == to) throw invalid();
            var selected = new StringBuilder();
            for (int i=a; i<=b; i++) {
                var block = blocks.get(i);
                int low=i==a ? from : 0, high=i==b ? to : block.text().length();
                if (i>a) selected.append('\n');
                selected.append(block.text(),low,high);
                int offset=0;
                for (var child:block.node().path("content")) {
                    int size=inline(child).length();
                    if (offset < high && offset+size > low && "researchCitation".equals(child.path("type").asString())) {
                        var ref=child.path("attrs").path("citation");
                        sources.add(new SourceReference(uuid(ref.path("sourceId")), nullableUuid(ref.path("sourceVersionId")),
                            ref.path("chunkId").asString(null),ref.path("processingVersion").asString(null)));
                    }
                    offset+=size;
                }
            }
            text=selected.toString();
            before=tail(first.text().substring(0,from),SURROUNDING_MAX);
            after=head(last.text().substring(to),SURROUNDING_MAX);
            if (target.kind()==Kind.SOURCE && (first!=last || to-from!=1 || sources.size()!=1)) throw invalid();
        }
        if (text.length()>SELECTED_MAX) throw new ApiException(ApiErrorCode.AI_CONTEXT_TOO_LARGE,"Select at most 4000 UTF-16 units");
        String fingerprint=target.kind()==Kind.CARET ? tail(before,32)+"\u0000"+head(after,32) : text;
        if (!hash(fingerprint).equals(target.hash())) throw stale("TARGET_STALE");
        var canonical=new Target(target.kind(),new Endpoint(first.id(),first.path(),target.start().offset()),new Endpoint(last.id(),last.path(),target.end().offset()),target.hash());
        var snapshot=new Snapshot(canonical,text,before,after,List.copyOf(sources),List.copyOf(analyses));
        if (json.writeValueAsBytes(snapshot).length>SNAPSHOT_MAX_BYTES) throw new ApiException(ApiErrorCode.AI_CONTEXT_TOO_LARGE,"The selected context exceeds the byte budget");
        return snapshot;
    }
    private void walk(JsonNode node,List<Integer> path,List<Block> blocks,int depth) {
        if (depth>64) throw invalid();
        String type=node.path("type").asString();
        if (Set.of("paragraph","heading","codeBlock","figureCaption","analysisResult").contains(type)) {
            String id=node.path("attrs").path("blockId").asString(null);
            var text=new StringBuilder(); node.path("content").forEach(child -> text.append(inline(child)));
            blocks.add(new Block(node,path,id,"analysisResult".equals(type) ? "\uFFFC" : text.toString())); return;
        }
        int index=0; for (var child:node.path("content")) {
            var next=new ArrayList<>(path);next.add(index++);walk(child,List.copyOf(next),blocks,depth+1);
        }
    }
    private Block find(List<Block> blocks,Endpoint endpoint) {
        if (endpoint.path()==null || endpoint.path().isEmpty() || endpoint.path().size()>64 || endpoint.offset()<0
                || endpoint.path().stream().anyMatch(i -> i==null || i<0)) throw invalid();
        var matches=blocks.stream().filter(b -> endpoint.blockId()!=null ? endpoint.blockId().equals(b.id()) : b.path().equals(endpoint.path())).toList();
        if (matches.size()!=1) throw stale("TARGET_STALE");
        var block=matches.getFirst();
        if (endpoint.offset()>block.text().length() || splitsSurrogate(block.text(),endpoint.offset())) throw invalid();
        return block;
    }
    private static boolean splitsSurrogate(String text,int offset) {
        return offset>0 && offset<text.length() && Character.isHighSurrogate(text.charAt(offset-1)) && Character.isLowSurrogate(text.charAt(offset));
    }
    private static String inline(JsonNode node) { return "text".equals(node.path("type").asString()) ? node.path("text").asString() : "\uFFFC"; }
    private static UUID uuid(JsonNode node) { try { return UUID.fromString(node.asString()); } catch(RuntimeException e) { throw invalid(); } }
    private static UUID nullableUuid(JsonNode node) { return node.isMissingNode() || node.isNull() ? null : uuid(node); }
    private static String head(String text,int size) { int end=Math.min(size,text.length());if(splitsSurrogate(text,end))end--;return text.substring(0,end); }
    private static String tail(String text,int size) { int start=Math.max(0,text.length()-size);if(splitsSurrogate(text,start))start++;return text.substring(start); }
    public static String hash(String text) {
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(text.getBytes(StandardCharsets.UTF_8))); }
        catch(java.security.NoSuchAlgorithmException e) { throw new IllegalStateException(e); }
    }
    public static ApiException stale(String reason) { return new CanvasConflict(reason); }
    private static final class CanvasConflict extends ApiException {
        CanvasConflict(String reason) { super(ApiErrorCode.CONFLICT,"The document context changed. Synchronize and select the target again.",Map.of("reason",reason)); }
    }
    private static ApiException invalid() { return new ApiException(ApiErrorCode.VALIDATION_FAILED,"Choose a valid saved text range, caret, citation or analysis block"); }
}
