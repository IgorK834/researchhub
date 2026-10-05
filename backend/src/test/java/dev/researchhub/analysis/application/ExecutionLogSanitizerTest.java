package dev.researchhub.analysis.application;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class ExecutionLogSanitizerTest {
    @Test void removesTerminalControlAndDirectionOverridesAndRedactsCredentialShapedValues() {
        var summary=ExecutionLogSanitizer.summarize("\u001B[31mresult\u001B[0m\r\n\u001B]0;terminal title\u0007value\u0000\u202E\npassword=hidden api_key: abc\nAuthorization: Bearer private");
        assertEquals("result\nvalue\npassword=[redacted] api_key: [redacted]\nAuthorization: Bearer [redacted]",summary.text());
        assertFalse(summary.truncated());
        assertEquals("",ExecutionLogSanitizer.summarize(null).text());
        assertEquals("\tdata\n",ExecutionLogSanitizer.summarize("\tdata\r").text());
    }
    @Test void capsPersistedSummariesAndReportsTruncationWithoutReturningTheTail() {
        var summary=ExecutionLogSanitizer.summarize("x".repeat(8192)+"hidden tail");
        assertEquals(8192,summary.text().length());assertTrue(summary.truncated());assertFalse(summary.text().contains("tail"));
    }
}
