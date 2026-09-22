package dev.researchhub.shared.validation;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

class NormalizeTest {

    @Test
    void trimsLeadingAndTrailingWhitespace() {
        assertEquals("Alice", Normalize.trim("  Alice  "));
    }

    @Test
    void leavesNullUnchanged() {
        assertNull(Normalize.trim(null));
    }

    @Test
    void whitespaceOnlyValueBecomesEmpty() {
        assertEquals("", Normalize.trim("   "));
    }

    @Test
    void valueWithoutSurroundingWhitespaceIsUnchanged() {
        assertEquals("Alice", Normalize.trim("Alice"));
    }

}
