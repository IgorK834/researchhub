package dev.researchhub.analysis.infrastructure;

import java.nio.file.Path;
import java.time.Duration;
import java.util.List;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class DockerCommandsTest {
    public static class Flood {
        public static void main(String[] args) throws Exception {
            byte[] bytes = new byte[8192];
            for (int i = 0; i < 100; i++) { System.out.write(bytes); System.err.write(bytes); }
            if (args.length != 0) Thread.sleep(60000);
        }
    }
    List<String> command(boolean sleep) {
        var command = new java.util.ArrayList<>(List.of(Path.of(System.getProperty("java.home"), "bin/java").toString(), "-cp", System.getProperty("java.class.path"), Flood.class.getName()));
        if (sleep) command.add("sleep"); return command;
    }
    @Test void continuouslyDrainsBothStreamsBeyondIndependentCaps() throws Exception {
        var reply = new DockerCommands.Local().execute(command(false), Duration.ofSeconds(10), 1000, 2000);
        assertEquals(0, reply.exitCode()); assertFalse(reply.timedOut());
        assertEquals(1000, reply.stdout().length); assertEquals(2000, reply.stderr().length);
        assertTrue(reply.stdoutTruncated()); assertTrue(reply.stderrTruncated());
    }
    @Test void timeoutKillsTheTrustedCliWithoutWaitingForItsOutput() throws Exception {
        long start = System.nanoTime();
        var reply = new DockerCommands.Local().execute(command(true), Duration.ofMillis(200), 1000, 2000);
        assertTrue(reply.timedOut()); assertEquals(-1, reply.exitCode());
        assertTrue(Duration.ofNanos(System.nanoTime() - start).compareTo(Duration.ofSeconds(5)) < 0);
    }
    @Test void missingCliIsAReadOnlyStartupFailure() {
        assertThrows(java.io.IOException.class, () -> new DockerCommands.Local().execute(List.of("/nonexistent/docker-cli"), Duration.ofSeconds(1), 1, 1));
    }
}
