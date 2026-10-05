package dev.researchhub.analysis.infrastructure;

import java.time.Duration;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class SandboxPropertiesTest {
    @Test void disabledByDefaultWithBoundedServerOwnedLimits() {
        var p = new SandboxProperties(); assertFalse(p.isEnabled()); assertEquals(256, p.getMemoryMiB()); assertEquals(64, p.getPids()); assertEquals(1, p.getCpus());
        assertEquals(Duration.ofSeconds(45), p.getTimeout()); assertEquals("/var/run/docker.sock", p.getSocketPath());
        p.setEnabled(true); p.setTimeout(Duration.ofMinutes(2)); p.setMemoryMiB(512); p.setPids(128); p.setCpus(2); p.setSocketPath("/tmp/docker.sock");
        assertTrue(p.isEnabled()); assertEquals(512, p.getMemoryMiB()); assertEquals(128, p.getPids()); assertEquals(2, p.getCpus()); assertEquals("/tmp/docker.sock", p.getSocketPath());
        for (Duration value : new Duration[]{null, Duration.ZERO, Duration.ofMillis(-1), Duration.ofSeconds(121)}) assertThrows(IllegalArgumentException.class, () -> p.setTimeout(value));
        for (int value : new int[]{63, 513}) assertThrows(IllegalArgumentException.class, () -> p.setMemoryMiB(value));
        for (int value : new int[]{7, 129}) assertThrows(IllegalArgumentException.class, () -> p.setPids(value));
        for (double value : new double[]{0, -1, 2.01, Double.NaN, Double.POSITIVE_INFINITY}) assertThrows(IllegalArgumentException.class, () -> p.setCpus(value));
        for (String value : new String[]{null, "tcp://host:2375", "relative/socket", "/tmp/a,b", "/tmp/a\n"}) assertThrows(IllegalArgumentException.class, () -> p.setSocketPath(value));
    }
}
