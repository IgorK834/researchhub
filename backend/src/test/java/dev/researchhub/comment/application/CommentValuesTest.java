package dev.researchhub.comment.application;

import dev.researchhub.comment.domain.CommentBody;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.ObjectMapper;

import java.util.Set;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;

class CommentValuesTest {
    @Test void boundedPlainTextAndAnchorMetadataAreRequired() {
        assertEquals("Review", new CommentBody(" Review ").value());
        assertEquals("x".repeat(4000), new CommentBody("x".repeat(4000)).value());
        for (String text : new String[]{null, "", " \n ", "x".repeat(4001)}) assertThrows(IllegalArgumentException.class, () -> new CommentBody(text));
        UUID id = UUID.randomUUID();
        assertEquals(id, new CommentContracts.Anchor("TEXT_MARK_V1", id, "Quote").id());
        assertThrows(IllegalArgumentException.class, () -> new CommentContracts.Anchor(null, id, "Quote"));
        assertThrows(IllegalArgumentException.class, () -> new CommentContracts.Anchor("OFFSET", id, "Quote"));
        assertThrows(IllegalArgumentException.class, () -> new CommentContracts.Anchor("TEXT_MARK_V1", null, "Quote"));
        for (String quote : new String[]{null, " ", "x".repeat(2001)}) assertThrows(IllegalArgumentException.class, () -> new CommentContracts.Anchor("TEXT_MARK_V1", id, quote));
    }
    @Test void missingInvalidEmptyAndOverlappingAnchorsAreSafe() {
        CommentAnchors anchors = new CommentAnchors(new ObjectMapper());
        UUID first = UUID.randomUUID(), second = UUID.randomUUID();
        String content = """
                {"type":"doc","content":[{"type":"blockquote","content":[{"type":"paragraph","content":[
                {"type":"text","text":"Evidence","marks":[{"type":"bold"},{"type":"commentAnchor","attrs":{"ids":["%s","%s","malformed",null,123]}}]},
                {"type":"text","text":" ","marks":[{"type":"commentAnchor","attrs":{"ids":["%s"]}}]}]}]}]}
                """.formatted(first, second, UUID.randomUUID());
        assertEquals(Set.of(first, second), anchors.in(content));
        assertTrue(anchors.in("{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\"},{}]}").isEmpty());
    }
}
