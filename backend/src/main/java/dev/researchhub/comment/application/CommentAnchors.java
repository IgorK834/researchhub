package dev.researchhub.comment.application;

import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.util.HashSet;
import java.util.Set;
import java.util.UUID;

/** Only live marked text counts. Missing/malformed marks are orphans, never fuzzy quote matches. */
@Component
public class CommentAnchors {
    private final ObjectMapper json;
    public CommentAnchors(ObjectMapper json) { this.json = json; }
    public Set<UUID> in(String content) {
        Set<UUID> result = new HashSet<>();
        visit(json.readTree(content), result);
        return result;
    }
    /** Read live marked text in document order. The historical quote is never used as model input. */
    public String claim(String content, UUID anchor) {
        var text = new StringBuilder();
        claim(json.readTree(content), anchor.toString(), text);
        if (text.isEmpty() || text.toString().isBlank() || text.length() > 2000)
            throw new dev.researchhub.shared.error.ConflictException("The highlighted claim is unavailable or exceeds 2000 characters. Select text again.");
        return text.toString();
    }
    private static void claim(JsonNode node, String anchor, StringBuilder text) {
        if ("text".equals(node.path("type").asString(""))) {
            boolean marked = false;
            for (var mark : node.path("marks")) if ("commentAnchor".equals(mark.path("type").asString("")))
                for (var id : mark.path("attrs").path("ids")) if (anchor.equals(id.asString(""))) marked = true;
            if (marked) text.append(node.path("text").asString(""));
        }
        for (var child : node.path("content")) claim(child, anchor, text);
    }
    private static void visit(JsonNode node, Set<UUID> result) {
        if (node.path("type").asString("").equals("text") && !node.path("text").asString("").isBlank()) {
            for (JsonNode mark : node.path("marks")) {
                if (!mark.path("type").asString("").equals("commentAnchor")) continue;
                for (JsonNode id : mark.path("attrs").path("ids")) {
                    if (!id.isString()) continue;
                    try { result.add(UUID.fromString(id.asString())); }
                    catch (IllegalArgumentException malformed) { /* An invalid anchor is simply unavailable. */ }
                }
            }
        }
        for (JsonNode child : node.path("content")) visit(child, result);
    }
}
