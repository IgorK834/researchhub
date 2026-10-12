package dev.researchhub.document.application;

import static org.junit.jupiter.api.Assertions.*;

import dev.researchhub.document.application.CanvasTargets.*;
import dev.researchhub.shared.error.ApiException;

import org.junit.jupiter.api.Test;

import tools.jackson.databind.*;

import java.util.*;

class CanvasEditTest {
    final ObjectMapper json = new ObjectMapper();
    final CanvasEdit edit = new CanvasEdit(json);
    final String id = UUID.randomUUID().toString();

    String doc(String inline) {
        return "{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\",\"attrs\":{\"blockId\":\""
                + id
                + "\"},\"content\":"
                + inline
                + "},{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"text\":\"outside\"}]}]}";
    }

    Target target(int start, int end, String text) {
        return new Target(
                start == end ? Kind.CARET : Kind.TEXT,
                new Endpoint(id, List.of(0), start),
                new Endpoint(id, List.of(0), end),
                CanvasDocumentTarget.hash(text));
    }

    @Test
    void splicesUtf16MarkedTextAndAtomsAndUndoDoesNotEraseEdits() {
        String content =
                doc(
                        "[{\"type\":\"text\",\"text\":\"A😀B\",\"marks\":[{\"type\":\"bold\"}]},{\"type\":\"hardBreak\"},{\"type\":\"text\",\"text\":\"suffix\"}]");
        var patch =
                edit.plan(
                        content,
                        target(1, 3, "😀"),
                        true,
                        List.of("one", "two"),
                        json.createArrayNode(),
                        UUID.randomUUID());
        String applied = edit.apply(content, patch);
        var body = json.readTree(applied).path("content");
        assertEquals(5, body.size());
        assertEquals("A", body.get(0).at("/content/0/text").asString());
        assertEquals("bold", body.get(3).at("/content/0/marks/0/type").asString());
        assertEquals("hardBreak", body.get(3).at("/content/1/type").asString());
        assertEquals(json.readTree(content), json.readTree(edit.apply(applied, patch.inverse())));
        assertThrows(
                ApiException.class,
                () -> edit.apply(applied.replace("one", "human"), patch.inverse()));
        assertThrows(ApiException.class, () -> edit.apply(content, patch.inverse()));
    }

    @Test
    void insertsAtEmptyBlockAtBothEdgesAndTracksPreviouslyUntaggedBlocks() {
        String content = doc("[]");
        var patch =
                edit.plan(
                        content,
                        target(0, 0, "\0"),
                        false,
                        List.of("new"),
                        json.createArrayNode(),
                        UUID.randomUUID());
        assertEquals(2, json.readTree(edit.apply(content, patch)).path("content").size());
        content = doc("[{\"type\":\"text\",\"text\":\"text\"}]");
        var first =
                edit.plan(
                        content,
                        target(0, 0, "\0text"),
                        false,
                        List.of("new"),
                        json.createArrayNode(),
                        UUID.randomUUID());
        assertEquals(3, json.readTree(edit.apply(content, first)).path("content").size());
        var last =
                edit.plan(
                        content,
                        target(4, 4, "text\0"),
                        false,
                        List.of("new"),
                        json.createArrayNode(),
                        UUID.randomUUID());
        assertEquals(3, json.readTree(edit.apply(content, last)).path("content").size());
        String untagged = content.replace("\"blockId\":\"" + id + "\"", "\"blockId\":null");
        var t =
                new Target(
                        Kind.CARET,
                        new Endpoint(null, List.of(0), 2),
                        new Endpoint(null, List.of(0), 2),
                        CanvasDocumentTarget.hash("te\0xt"));
        var split =
                edit.plan(
                        untagged,
                        t,
                        false,
                        List.of("new"),
                        json.createArrayNode(),
                        UUID.randomUUID());
        assertNotEquals(
                split.after().getFirst().at("/attrs/blockId"),
                split.after().getLast().at("/attrs/blockId"));
        assertEquals(
                json.readTree(untagged),
                json.readTree(edit.apply(edit.apply(untagged, split), split.inverse())));
    }

    @Test
    void crossParagraphReplaceClipsCommentsAndAddsOnlyResolvedCitations() {
        String content =
                doc(
                        "[{\"type\":\"text\",\"text\":\"first\",\"marks\":[{\"type\":\"commentAnchor\",\"attrs\":{\"ids\":[\"comment\"]}}]}]");
        var t =
                new Target(
                        Kind.TEXT,
                        new Endpoint(id, List.of(0), 2),
                        new Endpoint(null, List.of(1), 3),
                        CanvasDocumentTarget.hash("rst\nout"));
        var citation =
                json.createArrayNode().addObject().put("sourceId", UUID.randomUUID().toString());
        var patch =
                edit.plan(
                        content,
                        t,
                        true,
                        List.of("draft"),
                        json.createArrayNode().add(citation),
                        UUID.randomUUID());
        var applied = json.readTree(edit.apply(content, patch));
        assertEquals("fi", applied.at("/content/0/content/0/text").asString());
        assertEquals("side", applied.at("/content/2/content/0/text").asString());
        assertEquals("researchCitation", applied.at("/content/1/content/1/type").asString());
        assertEquals(1, edit.warnings(content, t, true).size());
        assertEquals(List.of(), edit.warnings(content, t, false));
    }

    @Test
    void stableSpliceFindsMovedParentAndRejectsMissingDuplicateIdentityOrStructuralCrossing() {
        String content = doc("[{\"type\":\"text\",\"text\":\"text\"}]");
        var p =
                edit.plan(
                        content,
                        target(0, 4, "text"),
                        true,
                        List.of("new"),
                        json.createArrayNode(),
                        UUID.randomUUID());
        String moved =
                "{\"type\":\"doc\",\"content\":[{\"type\":\"blockquote\",\"content\":"
                        + json.readTree(content).path("content")
                        + "}]}";
        assertTrue(edit.apply(moved, p).contains("new"));
        assertThrows(
                ApiException.class,
                () -> edit.apply(content.replace(id, UUID.randomUUID().toString()), p));
        String duplicate =
                "{\"type\":\"doc\",\"content\":["
                        + json.readTree(content).path("content").get(0)
                        + ","
                        + json.readTree(content).path("content").get(0)
                        + "]}";
        assertThrows(ApiException.class, () -> edit.apply(duplicate, p));
        assertThrows(
                ApiException.class,
                () ->
                        edit.plan(
                                content,
                                target(0, 0, "\0text"),
                                true,
                                List.of("new"),
                                json.createArrayNode(),
                                UUID.randomUUID()));
        String nested =
                content.replace(
                        "{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"text\":\"outside\"}]}",
                        "{\"type\":\"blockquote\",\"content\":[{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"text\":\"outside\"}]}]}");
        var cross =
                new Target(
                        Kind.TEXT,
                        new Endpoint(id, List.of(0), 0),
                        new Endpoint(null, List.of(1, 0), 1),
                        CanvasDocumentTarget.hash("text\no"));
        assertThrows(
                ApiException.class,
                () ->
                        edit.plan(
                                nested,
                                cross,
                                true,
                                List.of("new"),
                                json.createArrayNode(),
                                UUID.randomUUID()));
    }
}
