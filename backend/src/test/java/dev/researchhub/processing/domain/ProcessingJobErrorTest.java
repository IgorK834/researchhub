package dev.researchhub.processing.domain;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

class ProcessingJobErrorTest {

    @Test
    void trimsAndKeepsOnlyBoundedSafeValues() {
        ProcessingJobError error = new ProcessingJobError(" WORKER_TIMEOUT ", " Try again later. ");

        assertEquals("WORKER_TIMEOUT", error.code());
        assertEquals("Try again later.", error.message());
        assertThrows(IllegalArgumentException.class, () -> new ProcessingJobError("private-detail", "safe"));
        assertThrows(IllegalArgumentException.class, () -> new ProcessingJobError("A".repeat(65), "safe"));
        assertThrows(IllegalArgumentException.class, () -> new ProcessingJobError("SAFE", " "));
        assertThrows(IllegalArgumentException.class, () -> new ProcessingJobError("SAFE", "x".repeat(501)));
        assertThrows(NullPointerException.class, () -> new ProcessingJobError(null, "safe"));
        assertThrows(NullPointerException.class, () -> new ProcessingJobError("SAFE", null));
    }
}
