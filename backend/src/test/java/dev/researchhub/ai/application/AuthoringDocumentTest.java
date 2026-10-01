package dev.researchhub.ai.application;

import org.junit.jupiter.api.Test;
import tools.jackson.databind.ObjectMapper;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

class AuthoringDocumentTest {
    private final ObjectMapper json=new ObjectMapper();
    private final AuthoringDocument editing=new AuthoringDocument(json);
    private String prose(String text) { return "{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"text\":\""+text+"\",\"marks\":[{\"type\":\"bold\"}]}]}]}"; }
    private GenerationContracts.Citation citation() { return new GenerationContracts.Citation("a".repeat(64),UUID.randomUUID(),UUID.randomUUID(),null,"v1","b".repeat(64),1,1,null,List.of(new SourceSpan("p1",0,10)),"Lecture"); }
    @Test void fragmentBoundsContextAndKeepsUtf16OffsetsAndMarks() {
        var fragment=editing.fragment(prose("Before 😀 claim after"),8,16);
        assertEquals("😀 claim",fragment.text()); assertEquals("Before ",fragment.before()); assertEquals(" after",fragment.after()); assertFalse(fragment.warnings().isEmpty());
        var changed=json.readTree(editing.rewrite(prose("Before 😀 claim after"),8,16,"better",List.of()));
        var children=changed.path("content").get(0).path("content");
        assertEquals("Before ",children.get(0).path("text").asString()); assertEquals("better",children.get(1).path("text").asString());
        assertEquals("bold",children.get(1).path("marks").get(0).path("type").asString()); assertEquals(" after",children.get(2).path("text").asString());
        var bounded=editing.fragment(prose("a".repeat(600)),251,351); assertEquals(200,bounded.before().length()); assertEquals(200,bounded.after().length());
    }
    @Test void retainsOriginalCitationWhileFlaggingRelocationAndPreservesOtherNodes() {
        var cited=editing.addCitation(prose("Human claim. Suffix"),1,13,citation());
        var fragment=editing.fragment(cited,1,14); assertTrue(fragment.warnings().stream().anyMatch(w -> w.contains("citations")));
        var changed=json.readTree(editing.rewrite(cited,1,14,"Rewritten.",List.of(citation())));
        var inline=changed.path("content").get(0).path("content");
        assertEquals("Rewritten.",inline.get(0).path("text").asString()); assertEquals("researchCitation",inline.get(1).path("type").asString());
        assertEquals("researchCitation",inline.get(2).path("type").asString()); assertEquals(" Suffix",inline.get(3).path("text").asString());
    }
    @Test void sectionPlacementAndCitationAdditionDoNotRewriteProse() {
        var cited=json.readTree(editing.addCitation(prose("Human claim"),1,12,citation()));
        assertEquals("Human claim",cited.path("content").get(0).path("content").get(0).path("text").asString());
        var section=json.readTree(editing.insertSection(prose("Original"),0,"First\n\nSecond",List.of(citation())));
        assertEquals(3,section.path("content").size()); assertEquals("Original",section.path("content").get(2).path("content").get(0).path("text").asString());
        assertTrue(editing.placementContext(prose("Original"),1).startsWith("Original"));
    }
    @Test void spansParagraphsWithoutLosingUnselectedTextOrNestedFormatting() {
        String document="{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"text\":\"First\"}]},{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"text\":\"Second\"}]}]}";
        assertEquals("irst\nSec",editing.fragment(document,2,11).text());
        var changed=json.readTree(editing.rewrite(document,2,11,"Replacement",List.of()));
        assertEquals("F",changed.path("content").get(0).path("content").get(0).path("text").asString());
        assertEquals("ond",changed.path("content").get(1).path("content").get(0).path("text").asString());
        String nested="{\"type\":\"doc\",\"content\":[{\"type\":\"bulletList\",\"content\":[{\"type\":\"listItem\",\"content\":[{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"text\":\"Item\"}]}]}]}]}";
        assertEquals("Item",editing.fragment(nested,3,7).text()); assertTrue(editing.rewrite(nested,3,7,"Updated",List.of()).contains("bulletList"));
    }
    @Test void emptyParagraphBeforeSelectionDoesNotShiftProseMirrorPositions() {
        String content="{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\"},{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"text\":\"Claim\"}]}]}";
        assertEquals("Claim",editing.fragment(content,3,8).text());
        assertTrue(editing.rewrite(content,3,8,"New claim",List.of()).contains("New claim"));
    }
    @Test void rejectsUnsupportedInvalidOrUnboundedSelections() {
        for (int[] range:new int[][]{{0,1},{1,1},{1,100},{-1,3}}) assertThrows(dev.researchhub.shared.error.ApiException.class,() -> editing.fragment(prose("Text"),range[0],range[1]));
        assertThrows(dev.researchhub.shared.error.ApiException.class,() -> editing.fragment(prose("a".repeat(2001)),1,2002));
        assertThrows(dev.researchhub.shared.error.ApiException.class,() -> editing.fragment("{}",1,2));
        assertThrows(dev.researchhub.shared.error.ApiException.class,() -> editing.placementContext(prose("text"),2));
        assertThrows(dev.researchhub.shared.error.ApiException.class,() -> editing.fragment(prose("text").replace("paragraph","codeBlock"),1,2));
    }
}
