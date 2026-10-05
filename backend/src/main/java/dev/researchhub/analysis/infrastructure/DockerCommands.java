package dev.researchhub.analysis.infrastructure;

import java.io.*;
import java.time.Duration;
import java.util.List;
import java.util.concurrent.*;

/** CLI adapter never uses a shell. Both pipes are continuously drained even after their retention caps. */
interface DockerCommands {
    record Reply(int exitCode, boolean timedOut, byte[] stdout, byte[] stderr, boolean stdoutTruncated, boolean stderrTruncated) {}
    Reply execute(List<String> command, Duration timeout, int stdoutLimit, int stderrLimit) throws IOException, InterruptedException;

    final class Local implements DockerCommands {
        @Override public Reply execute(List<String> command, Duration timeout, int stdoutLimit, int stderrLimit)
            throws IOException, InterruptedException {
            ProcessBuilder builder = new ProcessBuilder(command);
            // The CLI is trusted, but it also receives no application credentials or implicit remote Docker context.
            builder.environment().clear();
            builder.environment().put("PATH", "/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin");
            Process process = builder.start();
            var out = new Capture(process.getInputStream(), stdoutLimit);
            var err = new Capture(process.getErrorStream(), stderrLimit);
            Thread outThread = Thread.ofVirtual().start(out);
            Thread errThread = Thread.ofVirtual().start(err);
            try {
                boolean done = process.waitFor(Math.max(1, timeout.toMillis()), TimeUnit.MILLISECONDS);
                if (!done) process.destroyForcibly();
                process.waitFor(2, TimeUnit.SECONDS);
                outThread.join(2000); errThread.join(2000);
                return new Reply(done ? process.exitValue() : -1, !done, out.bytes(), err.bytes(), out.truncated, err.truncated);
            } finally {
                process.destroyForcibly();
                process.getInputStream().close(); process.getErrorStream().close(); process.getOutputStream().close();
            }
        }
        private static final class Capture implements Runnable {
            private final InputStream stream;
            private final int limit;
            private final ByteArrayOutputStream retained = new ByteArrayOutputStream();
            private volatile boolean truncated;
            Capture(InputStream stream, int limit) { this.stream = stream; this.limit = limit; }
            @Override public void run() {
                byte[] buffer = new byte[8192];
                try {
                    int n;
                    while ((n = stream.read(buffer)) != -1) {
                        synchronized (retained) {
                            int keep = Math.min(n, limit - retained.size());
                            retained.write(buffer, 0, keep);
                            if (keep < n) truncated = true;
                        }
                    }
                } catch (IOException closed) { /* Timeout closes the stream after destroying the CLI. */ }
            }
            byte[] bytes() { synchronized (retained) { return retained.toByteArray(); } }
        }
    }
}
