package dev.researchhub.document.application;

import dev.researchhub.document.application.CanvasTargets.*;
import dev.researchhub.shared.error.*;

import tools.jackson.databind.*;
import tools.jackson.databind.node.*;

import java.nio.charset.StandardCharsets;
import java.util.*;

/**
 * Frozen, conditional subtree splice. Marks and inline atoms outside the range are copied verbatim.
 */
public final class CanvasEdit {
    public record Patch(
            List<Integer> parent,
            int index,
            List<JsonNode> before,
            List<JsonNode> after,
            List<UUID> generatedBlocks) {
        public Patch inverse() {
            return new Patch(parent, index, after, before, List.of());
        }
    }

    private final ObjectMapper json;

    public CanvasEdit(ObjectMapper json) {
        this.json = json;
    }

    public Patch plan(
            String content,
            Target target,
            boolean replace,
            List<String> paragraphs,
            JsonNode citations,
            UUID operation) {
        new CanvasDocumentTarget(json).capture(content, target);
        if (!Set.of(Kind.CARET, Kind.TEXT).contains(target.kind())
                || replace && target.kind() != Kind.TEXT)
            throw invalid("Choose text or a caret for an edit");
        var root = json.readTree(content);
        var a = locate(root, target.start());
        var b = locate(root, target.end());
        var parent = a.subList(0, a.size() - 1);
        if (!parent.equals(b.subList(0, b.size() - 1)))
            throw invalid("Select text within one paragraph, list item or table cell");
        int first = a.getLast(), last = replace ? b.getLast() : first;
        var children = at(root, parent).path("content");
        var before = new ArrayList<JsonNode>();
        for (int i = first; i <= last; i++) {
            var node = children.path(i);
            if (!Set.of("paragraph", "heading").contains(node.path("type").asString()))
                throw invalid("Select paragraphs or headings for an edit");
            before.add(node.deepCopy());
        }
        int start = target.start().offset(), end = replace ? target.end().offset() : start;
        var after = new ArrayList<JsonNode>();
        var generated = new ArrayList<UUID>();
        var prefix = slice(before.getFirst(), 0, start, identity(operation, "prefix"));
        if (start > 0) after.add(prefix);
        for (int i = 0; i < paragraphs.size(); i++) {
            UUID id = identity(operation, "paragraph:" + i);
            generated.add(id);
            var node = json.createObjectNode().put("type", "paragraph");
            node.putObject("attrs")
                    .put("blockId", id.toString())
                    .putNull("originIntent")
                    .putNull("importOperationId");
            var inline = node.putArray("content");
            inline.addObject().put("type", "text").put("text", paragraphs.get(i));
            // Every new claim in the evidence-backed draft carries the resolved immutable
            // references.
            for (var citation : citations) {
                var atom = inline.addObject().put("type", "researchCitation");
                atom.putObject("attrs").set("citation", citation);
            }
            after.add(node);
        }
        int length = length(before.getLast());
        if (end < length) {
            var suffix = slice(before.getLast(), end, length, identity(operation, "suffix"));
            // Splitting a single block must not duplicate its identity.
            if (start > 0 && first == last)
                ((ObjectNode) suffix.path("attrs"))
                        .put("blockId", identity(operation, "suffix").toString());
            after.add(suffix);
        }
        return new Patch(
                List.copyOf(parent),
                first,
                List.copyOf(before),
                List.copyOf(after),
                List.copyOf(generated));
    }

    public String apply(String content, Patch patch) {
        var root = json.readTree(content).deepCopy();
        // Stable identities permit edits outside the splice, including insertions before its
        // parent.
        List<Integer> parent = patch.parent();
        int index = patch.index();
        var id = patch.before().getFirst().path("attrs").path("blockId").asString(null);
        if (id != null) {
            var path = locate(root, new Endpoint(id, parent, 0));
            parent = path.subList(0, path.size() - 1);
            index = path.getLast();
        }
        var owner = at(root, parent);
        var array = owner.path("content");
        if (!array.isArray()) throw stale();
        for (int i = 0; i < patch.before().size(); i++)
            if (!equivalent(array.path(index + i), patch.before().get(i))) throw stale();
        var next = json.createArrayNode();
        for (int i = 0; i < index; i++) next.add(array.path(i));
        patch.after().forEach(next::add);
        for (int i = index + patch.before().size(); i < array.size(); i++) next.add(array.path(i));
        ((ObjectNode) owner).set("content", next);
        return json.writeValueAsString(root);
    }
    /** Only server-assembled semantic blocks enter this splice; document reference validators run at commit. */
    public Patch planBlocks(String content,Target target,boolean replace,List<JsonNode> blocks,UUID operation) {
        if(blocks.isEmpty() || blocks.size()>32)throw invalid("Choose a bounded saved calculation package");
        var base=plan(content,target,replace,List.of("package"),json.createArrayNode(),operation);
        var after=new ArrayList<JsonNode>();var ids=new ArrayList<UUID>();
        for(var node:base.after()) {
            if(base.generatedBlocks().contains(UUID.fromString(node.path("attrs").path("blockId").asString()))) {
                int i=0;
                for(var block:blocks) {
                    var copy=(ObjectNode)block.deepCopy();UUID id=identity(operation,"package:"+i++);
                    ((ObjectNode)copy.path("attrs")).put("blockId",id.toString());ids.add(id);after.add(copy);
                }
            } else after.add(node);
        }
        return new Patch(base.parent(),base.index(),base.before(),List.copyOf(after),List.copyOf(ids));
    }

    public List<String> warnings(String content, Target target, boolean replace) {
        if (!replace) return List.of();
        var snapshot = new CanvasDocumentTarget(json).capture(content, target);
        var warnings = new ArrayList<String>();
        if (!snapshot.sources().isEmpty())
            warnings.add(
                    "The selected citations will be replaced. Citations outside the selection stay"
                            + " in place.");
        // Conservative warning: clipped comment marks retain their surviving ranges; comment
        // records are never deleted.
        if (content.contains("commentAnchor"))
            warnings.add(
                    "Comment anchors inside the selected range may be shortened or removed; the"
                            + " comment history remains available.");
        return List.copyOf(warnings);
    }

    /**
     * ProseMirror materializes null defaults and omits empty inline arrays. They carry no content.
     */
    public boolean equivalent(JsonNode a, JsonNode b) {
        return semantic(a).equals(semantic(b));
    }

    private JsonNode semantic(JsonNode node) {
        if (node.isObject()) {
            var out = json.createObjectNode();
            node.properties()
                    .forEach(
                            e -> {
                                var value = semantic(e.getValue());
                                if (!value.isNull()
                                        && !(Set.of("attrs", "content", "marks")
                                                        .contains(e.getKey())
                                                && (value.isArray() || value.isObject())
                                                && value.isEmpty())) out.set(e.getKey(), value);
                            });
            return out;
        }
        if (node.isArray()) {
            var out = json.createArrayNode();
            node.forEach(n -> out.add(semantic(n)));
            return out;
        }
        return node;
    }

    private JsonNode slice(JsonNode node, int from, int to, UUID fallback) {
        var copy = (ObjectNode) node.deepCopy();
        var attrs =
                copy.path("attrs").isObject()
                        ? (ObjectNode) copy.path("attrs")
                        : copy.putObject("attrs");
        if (attrs.path("blockId").isNull() || attrs.path("blockId").isMissingNode())
            attrs.put("blockId", fallback.toString());
        var result = json.createArrayNode();
        int offset = 0;
        for (var child : node.path("content")) {
            boolean text = "text".equals(child.path("type").asString());
            int size = text ? child.path("text").asString().length() : 1;
            int low = Math.max(from - offset, 0), high = Math.min(to - offset, size);
            if (low < high) {
                var part = child.deepCopy();
                if (text)
                    ((ObjectNode) part)
                            .put("text", child.path("text").asString().substring(low, high));
                result.add(part);
            }
            offset += size;
        }
        copy.set("content", result);
        return copy;
    }

    private static int length(JsonNode node) {
        int n = 0;
        for (var c : node.path("content"))
            n += "text".equals(c.path("type").asString()) ? c.path("text").asString().length() : 1;
        return n;
    }

    private static UUID identity(UUID op, String label) {
        return UUID.nameUUIDFromBytes((op + ":" + label).getBytes(StandardCharsets.UTF_8));
    }

    private static JsonNode at(JsonNode node, List<Integer> path) {
        for (int i : path) node = node.path("content").path(i);
        return node;
    }

    private static List<Integer> locate(JsonNode root, Endpoint endpoint) {
        if (endpoint.blockId() == null) return endpoint.path();
        var paths = new ArrayList<List<Integer>>();
        find(root, List.of(), endpoint.blockId(), paths);
        if (paths.size() != 1) throw stale();
        return paths.getFirst();
    }

    private static void find(
            JsonNode node, List<Integer> path, String id, List<List<Integer>> found) {
        if (id.equals(node.path("attrs").path("blockId").asString())) found.add(path);
        int i = 0;
        for (var child : node.path("content")) {
            var next = new ArrayList<>(path);
            next.add(i++);
            find(child, List.copyOf(next), id, found);
        }
    }

    private static ApiException stale() {
        return CanvasDocumentTarget.stale("TARGET_STALE");
    }

    private static ApiException invalid(String text) {
        return new ApiException(ApiErrorCode.VALIDATION_FAILED, text);
    }
}
