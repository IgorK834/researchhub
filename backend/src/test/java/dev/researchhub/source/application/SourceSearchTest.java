package dev.researchhub.source.application;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class SourceSearchTest {
    @Test void normalizesLiteralSearchAndLabels() {
        var search = new SourceSearch("  A_%  ", "PDF", null, "READY", " Review ", " Papers ", 2, 30);
        assertEquals("a_%", search.query());
        assertEquals("review", search.tag());
        assertEquals("papers", search.collection());
        assertEquals("", new SourceSearch(null, null, null, null, null, null, 0, 1).type());
    }
    @Test void rejectsInvalidEnumsAndPagination() {
        assertThrows(IllegalArgumentException.class, () -> new SourceSearch("x".repeat(201), "", null, "", "", "", 0, 30));
        assertThrows(IllegalArgumentException.class, () -> new SourceSearch("", "WEB", null, "", "", "", 0, 30));
        assertThrows(IllegalArgumentException.class, () -> new SourceSearch("", "", null, "OTHER", "", "", 0, 30));
        for (int page : new int[]{-1, 1000001}) assertThrows(IllegalArgumentException.class, () -> new SourceSearch("", "", null, "", "", "", page, 30));
        for (int size : new int[]{0, 101}) assertThrows(IllegalArgumentException.class, () -> new SourceSearch("", "", null, "", "", "", 0, size));
    }
}
