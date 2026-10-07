package dev.researchhub.export.application;

import dev.researchhub.export.domain.Report;
import dev.researchhub.export.domain.Report.*;
import dev.researchhub.shared.error.*;
import java.time.Instant;
import java.util.*;
import tools.jackson.databind.*;

/** The only component aware of stored ProseMirror node names. No live editor or browser is needed. */
public final class EditorReportAdapter {
    private final ObjectMapper json;
    public EditorReportAdapter(ObjectMapper json) { this.json=json; }
    public Report convert(UUID workspace,UUID document,long revision,String title,String stored,Instant now,
                          ExportReferences references,List<Origin> origins) {
        JsonNode root;
        try { root=json.readTree(stored); } catch (RuntimeException invalid) { throw invalid("Malformed document JSON"); }
        if (!root.isObject() || !"doc".equals(root.path("type").asString())) throw invalid("Unsupported document format");
        var state=new State(workspace,references);
        var blocks=state.blocks(root,0);
        return new Report("1.0",workspace,document,revision,title,now,blocks,
            new ArrayList<>(state.bibliography.values()),origins,new ArrayList<>(state.warnings));
    }
    private static final class State {
        final UUID workspace;
        final ExportReferences references;
        final Map<String,BibliographyEntry> bibliography=new LinkedHashMap<>();
        final Set<String> warnings=new LinkedHashSet<>();
        int nodes,cells;
        State(UUID workspace,ExportReferences references) { this.workspace=workspace;this.references=references; }
        List<Block> blocks(JsonNode parent,int depth) {
            var result=new ArrayList<Block>();
            for (var node:children(parent)) {
                check(depth);
                String type=node.path("type").asString("");
                switch (type) {
                    case "paragraph","figureCaption" -> result.add(new Paragraph(inlines(node,depth+1),type.equals("figureCaption")));
                    case "heading" -> {
                        int level=node.path("attrs").path("level").asInt(1);
                        if (level<1 || level>6) throw invalid("Unsupported heading level");
                        result.add(new Heading(level,inlines(node,depth+1)));
                    }
                    case "bulletList","orderedList" -> {
                        var items=new ArrayList<List<Block>>();
                        for (var item:children(node)) {
                            if (!"listItem".equals(item.path("type").asString())) throw invalid("Invalid list item");
                            items.add(blocks(item,depth+1));
                        }
                        int start=node.path("attrs").path("start").asInt(1);
                        if (start<1 || start>1000000) throw invalid("Invalid list start");
                        result.add(new ListBlock(type.equals("orderedList"),start,items));
                    }
                    case "table" -> result.add(table(node,depth+1));
                    case "figure","blockquote" -> result.add(new Container(blocks(node,depth+1),type.equals("blockquote")));
                    case "codeBlock" -> result.add(new Code(plain(node,depth+1)));
                    case "horizontalRule" -> result.add(new Rule());
                    case "analysisResult" -> {
                        var attrs=node.path("attrs");var ref=attrs.path("reference");
                        var output=references.analysis(uuid(ref,"analysisId"),uuid(ref,"executionId"),
                            required(ref,"outputId"),required(ref,"renderMode"),attrs.path("caption").asString(""));
                        for (var block:output) {
                            if (block instanceof Table t) countCells(t.rows().stream().mapToInt(List::size).sum());
                            result.add(block);
                        }
                    }
                    case "image" -> {
                        String src=required(node.path("attrs"),"src");
                        if (!src.startsWith("data:image/png;base64,") && !src.startsWith("data:image/jpeg;base64,"))
                            throw invalid("Export images must be embedded PNG/JPEG assets; remote URLs are unsupported");
                        if (src.length()>12_000_000) throw new PayloadTooLargeException("Export image exceeds the limit");
                        try { result.add(ReportImages.normalize(Base64.getDecoder().decode(src.substring(src.indexOf(',')+1)),
                            src.startsWith("data:image/png") ? "image/png" : "image/jpeg",node.path("attrs").path("alt").asString(""),"",null)); }
                        catch (IllegalArgumentException malformed) { throw invalid("Invalid embedded image"); }
                    }
                    default -> throw invalid("Unsupported document node: "+type);
                }
            }
            return result;
        }
        Table table(JsonNode node,int depth) {
            var rows=new ArrayList<List<Cell>>();
            for (var row:children(node)) {
                if (!"tableRow".equals(row.path("type").asString())) throw invalid("Invalid table row");
                var cells=new ArrayList<Cell>();
                for (var cell:children(row)) {
                    check(depth);countCells(1);
                    String type=cell.path("type").asString();
                    if (!Set.of("tableCell","tableHeader").contains(type)) throw invalid("Invalid table cell");
                    int colspan=cell.path("attrs").path("colspan").asInt(1),rowspan=cell.path("attrs").path("rowspan").asInt(1);
                    if (colspan<1 || colspan>100 || rowspan<1 || rowspan>1000) throw invalid("Invalid table span");
                    cells.add(new Cell(type.equals("tableHeader"),colspan,rowspan,blocks(cell,depth+1)));
                }
                if (cells.isEmpty()) throw invalid("Empty table row");
                rows.add(cells);
            }
            return new Table(rows,"",null);
        }
        List<Inline> inlines(JsonNode parent,int depth) {
            var result=new ArrayList<Inline>();
            for (var node:children(parent)) {
                check(depth);
                switch (node.path("type").asString("")) {
                    case "text" -> {
                        var styles=EnumSet.noneOf(Style.class);
                        for (var mark:node.path("marks")) {
                            switch (mark.path("type").asString("")) {
                                case "bold" -> styles.add(Style.BOLD);
                                case "italic" -> styles.add(Style.ITALIC);
                                case "underline" -> styles.add(Style.UNDERLINE);
                                case "strike" -> styles.add(Style.STRIKE);
                                case "code" -> styles.add(Style.CODE);
                                case "commentAnchor" -> { /* Review annotations are not report prose. */ }
                                default -> throw invalid("Unsupported text mark");
                            }
                        }
                        result.add(new Text(required(node,"text"),styles));
                    }
                    case "hardBreak" -> result.add(new Text("\n",Set.of()));
                    case "researchCitation" -> result.add(citation(node.path("attrs").path("citation")));
                    default -> throw invalid("Unsupported inline node");
                }
            }
            return result;
        }
        Citation citation(JsonNode c) {
            if (!workspace.equals(uuid(c,"workspaceId"))) throw invalid("Citation belongs to another workspace");
            var spans=new ArrayList<Span>();
            for (var span:c.path("spans")) spans.add(new Span(required(span,"unitId"),span.path("characterStart").asLong(0),span.path("characterEnd").asLong(0)));
            UUID version=c.path("sourceVersionId").isString() ? uuid(c,"sourceVersionId") : null;
            if (version==null) warnings.add("A legacy citation was bound to the current source version at export time.");
            Integer start=page(c,"pageStart"),end=page(c,"pageEnd");
            if (start!=null && end!=null && end<start) throw invalid("Invalid citation page range");
            var source=references.source(uuid(c,"sourceId"),version,required(c,"processingVersion"),optional(c,"chunkId"),optional(c,"contentHash"),
                start,end,optional(c,"sectionTitle"),spans);
            String key=source.sourceId()+":"+source.sourceVersionId();
            var entry=bibliography.computeIfAbsent(key,k -> new BibliographyEntry(bibliography.size()+1,source));
            return new Citation(entry.number(),source);
        }
        String plain(JsonNode node,int depth) {
            var content=inlines(node,depth);
            if (content.stream().anyMatch(i -> i instanceof Citation)) throw invalid("Citations inside code are unsupported");
            return content.stream().map(i -> ((Text)i).text()).reduce("",String::concat);
        }
        void check(int depth) { if (depth>64 || ++nodes>50000) throw new PayloadTooLargeException("Export document exceeds the structural limit"); }
        void countCells(int count) { cells+=count;if (cells>20000) throw new PayloadTooLargeException("Export is limited to 20000 table cells"); }
    }
    private static Iterable<JsonNode> children(JsonNode node) {
        var children=node.path("content");
        if (children.isMissingNode()) return List.of();
        if (!children.isArray()) throw invalid("Invalid document children");
        return children;
    }
    static UUID uuid(JsonNode node,String field) {
        try { return UUID.fromString(required(node,field)); } catch (IllegalArgumentException malformed) { throw invalid("Invalid reference identifier"); }
    }
    private static String required(JsonNode node,String field) {
        if (!node.path(field).isString()) throw invalid("Missing document field: "+field);
        return node.path(field).asString();
    }
    private static String optional(JsonNode node,String field) { return node.path(field).isString() ? node.path(field).asString() : null; }
    private static Integer page(JsonNode node,String field) {
        if (node.path(field).isNull() || node.path(field).isMissingNode()) return null;
        if (!node.path(field).isIntegralNumber() || node.path(field).asInt()<1) throw invalid("Invalid citation page");
        return node.path(field).asInt();
    }
    static ApiException invalid(String detail) { return new ApiException(ApiErrorCode.VALIDATION_FAILED,detail); }
}
