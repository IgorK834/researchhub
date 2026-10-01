package dev.researchhub.ai.application;

import dev.researchhub.shared.error.*;
import tools.jackson.databind.*;
import tools.jackson.databind.node.*;
import java.util.*;

/** Server-owned edits over the existing ProseMirror format. Offsets match JS/ProseMirror UTF-16. */
public final class AuthoringDocument {
    private final ObjectMapper json;
    public AuthoringDocument(ObjectMapper json) { this.json = json; }
    public record Fragment(String text, String before, String after, List<String> warnings) {}
    private record Block(ObjectNode node, int start, int end) {}
    private ObjectNode read(String content) {
        var node = json.readTree(content);
        if (!node.isObject() || !"doc".equals(node.path("type").asString()) || !node.path("content").isArray()) throw invalid();
        return (ObjectNode) node;
    }
    public String placementContext(String content, int index) {
        var blocks = read(content).withArray("content");
        if (index < 0 || index > blocks.size()) throw invalid();
        String before = index == 0 ? "" : plain(blocks.get(index - 1));
        String after = index == blocks.size() ? "" : plain(blocks.get(index));
        return tail(before, 200) + "\n" + head(after, 200);
    }
    private List<Block> blocks(ObjectNode root) {
        var result = new ArrayList<Block>();
        walk(root, -1, result, 0);
        return result;
    }
    private int walk(JsonNode node, int position, List<Block> result, int depth) {
        if (depth > 64) throw invalid();
        String type = node.path("type").asString();
        if ("text".equals(type)) return node.path("text").asString().length();
        if (!node.path("content").isArray()) {
            if (Set.of("paragraph", "heading", "codeBlock").contains(type)) {
                result.add(new Block((ObjectNode) node, position + 1, position + 1)); return 2;
            }
            return 1;
        }
        int size = 0;
        for (var child : node.path("content")) size += walk(child, position + 1 + size, result, depth + 1);
        if (Set.of("paragraph", "heading", "codeBlock").contains(type)) result.add(new Block((ObjectNode) node, position + 1, position + 1 + size));
        return "doc".equals(type) ? size : size + 2;
    }
    public Fragment fragment(String content, int from, int to) {
        var blocks = blocks(read(content));
        var selected = selected(blocks, from, to);
        var text = new StringBuilder();
        var warnings = new LinkedHashSet<String>();
        for (var block : selected) {
            if (!text.isEmpty()) text.append('\n');
            int pos = block.start();
            for (var node : block.node().path("content")) {
                int size = inlineSize(node);
                int start = Math.max(from, pos), end = Math.min(to, pos + size);
                if (start < end) {
                    if ("text".equals(node.path("type").asString())) {
                        text.append(node.path("text").asString().substring(start - pos, end - pos));
                        if (node.has("marks")) warnings.add("Semantic formatting may be transformed in the replacement; review the suggestion.");
                    } else if ("researchCitation".equals(node.path("type").asString()))
                        warnings.add("Existing citations are retained at the end of the replacement; review their placement.");
                    else warnings.add("Selected inline structure may be transformed; review the replacement.");
                }
                pos += size;
            }
        }
        if (text.isEmpty() || text.toString().isBlank() || text.length() > 2000) throw invalid();
        if (selected.size() > 1) warnings.add("The replacement spans multiple text blocks; review paragraph structure.");
        String first = plain(selected.getFirst().node()), last = plain(selected.getLast().node());
        int before = Math.min(from - selected.getFirst().start(), first.length());
        int after = Math.min(to - selected.getLast().start(), last.length());
        return new Fragment(text.toString(), tail(first.substring(0, before), 200), head(last.substring(after), 200), List.copyOf(warnings));
    }
    private List<Block> selected(List<Block> blocks, int from, int to) {
        if (from < 0 || to <= from) throw invalid();
        var selected = blocks.stream().filter(b -> b.start() < to && b.end() > from).toList();
        if (selected.isEmpty() || from < selected.getFirst().start() || to > selected.getLast().end()) throw invalid();
        // Refuse structural/partial-node selections rather than silently deleting tables or lists.
        if (blocks.stream().anyMatch(b -> b.start() < to && b.end() > from && b.node().path("type").asString().equals("codeBlock"))) throw invalid();
        return selected;
    }
    public String insertSection(String content, int index, String text, List<GenerationContracts.Citation> citations) {
        var root = read(content); placementContext(content, index);
        var existing = root.withArray("content"); var replacement = json.createArrayNode();
        for (int i = 0; i < index; i++) replacement.add(existing.get(i));
        var paragraphs = text.split("\\n\\s*\\n");
        for (int i = 0; i < paragraphs.length; i++) {
            var paragraph = json.createObjectNode().put("type", "paragraph");
            var inline = paragraph.putArray("content"); inline.add(textNode(paragraphs[i], null));
            if (i == paragraphs.length - 1) citations.forEach(c -> inline.add(citationNode(c)));
            replacement.add(paragraph);
        }
        for (int i = index; i < existing.size(); i++) replacement.add(existing.get(i));
        root.set("content", replacement); return json.writeValueAsString(root);
    }
    public String rewrite(String content, int from, int to, String text, List<GenerationContracts.Citation> citations) {
        var root = read(content); var selected = selected(blocks(root), from, to);
        // Retain original citations, including their immutable version/location metadata.
        var retained = new ArrayList<JsonNode>();
        for (var block : selected) {
            int pos = block.start();
            for (var node : block.node().path("content")) {
                if (pos < to && pos + inlineSize(node) > from && "researchCitation".equals(node.path("type").asString())) retained.add(node);
                pos += inlineSize(node);
            }
        }
        for (var block : selected) {
            var inline = json.createArrayNode(); int pos = block.start(); boolean inserted = false;
            for (var node : block.node().path("content")) {
                int size = inlineSize(node); int start = Math.max(from, pos), end = Math.min(to, pos + size);
                if (start >= end) inline.add(node);
                else {
                    boolean isText = "text".equals(node.path("type").asString());
                    if (isText && start > pos) inline.add(textNode(node.path("text").asString().substring(0, start - pos), node.get("marks")));
                    if (block == selected.getFirst() && !inserted) {
                        // A single-node replacement can keep its formatting precisely.
                        var marks = selected.size() == 1 && from >= pos && to <= pos + size ? node.get("marks") : null;
                        inline.add(textNode(text, marks)); retained.forEach(inline::add); citations.forEach(c -> inline.add(citationNode(c))); inserted = true;
                    }
                    if (isText && end < pos + size) inline.add(textNode(node.path("text").asString().substring(end - pos), node.get("marks")));
                }
                pos += size;
            }
            block.node().set("content", inline);
        }
        return json.writeValueAsString(root);
    }
    public String addCitation(String content, int from, int to, GenerationContracts.Citation citation) {
        var root = read(content); var block = selected(blocks(root), from, to).getLast();
        var inline = json.createArrayNode(); int pos = block.start(); boolean added = false;
        for (var node : block.node().path("content")) {
            int size = inlineSize(node);
            if (!added && to >= pos && to <= pos + size) {
                if ("text".equals(node.path("type").asString()) && to > pos && to < pos + size) {
                    inline.add(textNode(node.path("text").asString().substring(0, to - pos), node.get("marks")));
                    inline.add(citationNode(citation));
                    inline.add(textNode(node.path("text").asString().substring(to - pos), node.get("marks")));
                } else { if (to == pos) inline.add(citationNode(citation)); inline.add(node); if (to != pos) inline.add(citationNode(citation)); }
                added = true;
            } else inline.add(node);
            pos += size;
        }
        if (!added) throw invalid();
        block.node().set("content", inline); return json.writeValueAsString(root);
    }
    private ObjectNode textNode(String text, JsonNode marks) {
        var node = json.createObjectNode().put("type", "text").put("text", text);
        if (marks != null) node.set("marks", marks); return node;
    }
    private ObjectNode citationNode(GenerationContracts.Citation citation) {
        var node = json.createObjectNode().put("type", "researchCitation");
        node.putObject("attrs").set("citation", json.valueToTree(citation)); return node;
    }
    private static int inlineSize(JsonNode node) { return "text".equals(node.path("type").asString()) ? node.path("text").asString().length() : 1; }
    private static String plain(JsonNode node) {
        if ("text".equals(node.path("type").asString())) return node.path("text").asString();
        var text = new StringBuilder(); for (var child : node.path("content")) text.append(plain(child)); return text.toString();
    }
    private static String head(String text, int length) { return text.substring(0, Math.min(length, text.length())); }
    private static String tail(String text, int length) { return text.substring(Math.max(0, text.length() - length)); }
    private static ApiException invalid() { return new ApiException(ApiErrorCode.VALIDATION_FAILED, "Select 1–2000 characters of prose, or a valid section placement in the saved document"); }
}
