package dev.researchhub.source.application;

import dev.researchhub.source.domain.Source;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

class SourceLimitsTest {

    @Test
    void acceptsAnyLimitUpToTheSchemaCeiling() {
        assertEquals(1, new SourceLimits(1).maxSourceBytes());
        assertEquals(SourceLimits.HARD_MAX_BYTES, new SourceLimits(SourceLimits.HARD_MAX_BYTES).maxSourceBytes());
    }

    @Test
    void refusesALimitTheDatabaseWouldNotHonour() {
        assertThrows(IllegalArgumentException.class, () -> new SourceLimits(0));
        assertThrows(IllegalArgumentException.class, () -> new SourceLimits(SourceLimits.HARD_MAX_BYTES + 1));
    }

    @Test
    void describesTheLimitForPeople() {
        assertEquals("50 MB", new SourceLimits(52_428_800).describe());
        assertEquals("50 MB", new SourceLimits(SourceLimits.HARD_MAX_BYTES).describe());
        assertEquals("1000 bytes", new SourceLimits(1000).describe());
    }

}
