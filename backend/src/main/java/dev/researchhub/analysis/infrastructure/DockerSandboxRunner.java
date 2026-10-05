package dev.researchhub.analysis.infrastructure;

import dev.researchhub.analysis.application.SandboxRunner;
import dev.researchhub.analysis.application.ExecutionOutputValidator;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.nio.file.attribute.PosixFilePermissions;
import java.security.MessageDigest;
import java.time.Duration;
import java.util.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import tools.jackson.databind.ObjectMapper;

/** Local Docker is a privileged server dependency. Only validated bytes cross into this disposable container. */
@Component
public final class DockerSandboxRunner implements SandboxRunner {
    public static final String IMAGE = SandboxRunner.IMAGE;
    public static final String RUNTIME_VERSION = "1.0.0";
    static final int LOG_LIMIT = 64 * 1024;
    static final int OUTPUT_LIMIT = 16 * 1024 * 1024;
    private final SandboxProperties properties;
    private final ObjectMapper json;
    private final DockerCommands docker;

    @Autowired public DockerSandboxRunner(SandboxProperties properties, ObjectMapper json) {
        this(properties, json, new DockerCommands.Local());
    }
    DockerSandboxRunner(SandboxProperties properties, ObjectMapper json, DockerCommands docker) {
        this.properties = properties; this.json = json; this.docker = docker;
    }

    @Override public Result run(Request request) {
        if (!properties.isEnabled()) return failure("SANDBOX_DISABLED", null, null, null);
        String name = "rh-sandbox-" + request.executionId() + "-" + UUID.randomUUID();
        Path staging = null;
        Result result = failure("SANDBOX_UNAVAILABLE", null, null, null);
        String imageId = null;
        DockerCommands.Reply execution = null;
        boolean interrupted = false;
        long deadline = System.nanoTime() + properties.getTimeout().toNanos();
        try {
            staging = Files.createTempDirectory("rh-sandbox-", PosixFilePermissions.asFileAttribute(PosixFilePermissions.fromString("rwx------")));
            Path inputs = Files.createDirectory(staging.resolve("inputs"));
            Path source = Files.createDirectory(staging.resolve("execution"));
            Files.createDirectory(staging.resolve("docker-config"));
            stage(request, inputs, source);
            DockerCommands.Reply image = command(staging, deadline, 1024, "image", "inspect", "--format", "{{.Id}}", IMAGE);
            checked(image);
            imageId = string(image.stdout()).strip();
            if (!imageId.matches("sha256:[a-f0-9]{64}")) throw new Failure("SANDBOX_UNAVAILABLE");
            var arguments = new ArrayList<>(List.of("create", "--name", name, "--pull", "never", "--network", "none",
                "--read-only", "--ipc", "none", "--user", "65532:65532", "--cap-drop", "ALL", "--security-opt", "no-new-privileges:true",
                "--memory", properties.getMemoryMiB() + "m", "--memory-swap", properties.getMemoryMiB() + "m",
                "--cpus", Double.toString(properties.getCpus()), "--pids-limit", Integer.toString(properties.getPids()),
                "--ulimit", "nofile=128:128", "--ulimit", "core=0:0", "--log-driver", "none",
                "--mount", "type=bind,src=" + source + ",dst=/execution,readonly",
                "--mount", "type=bind,src=" + inputs + ",dst=/inputs,readonly",
                // Docker's archive API excludes direct tmpfs mounts. An anonymous local tmpfs volume
                // keeps the same hard caps, is visible while paused and is removed with --volumes.
                "--mount", "type=volume,dst=/outputs,volume-nocopy,volume-driver=local,volume-opt=type=tmpfs,volume-opt=device=tmpfs,\"volume-opt=o=size=16777216,nr_inodes=128,noexec,nosuid,nodev,uid=65532,gid=65532,mode=0700\"",
                "--tmpfs", "/tmp:rw,noexec,nosuid,nodev,size=16777216,nr_inodes=256,uid=65532,gid=65532,mode=0700",
                "--workdir", "/execution", "--entrypoint", "python", imageId, "-I", "-c", "import time;time.sleep(135)"));
            checked(command(staging, deadline, 1024, arguments.toArray(String[]::new)));
            checked(command(staging, deadline, 1024, "start", name));
            execution = command(staging, deadline, LOG_LIMIT, "exec", name, "python", "-I", "/opt/researchhub/run.py");
            if (execution.timedOut()) throw new Failure("EXECUTION_TIMEOUT");
            if (execution.exitCode() != 0) {
                String code = execution.exitCode() == 137 ? "EXECUTION_RESOURCE_LIMIT" :
                    execution.exitCode() == 65 ? "EXECUTION_OUTPUT_INVALID" : "EXECUTION_FAILED";
                throw new Failure(code);
            }
            // Freeze surviving child processes before collecting; cp reads mounted tmpfs while PID1 remains alive.
            checked(command(staging, deadline, 1024, "pause", name));
            DockerCommands.Reply archive = command(staging, deadline, OUTPUT_LIMIT + 64 * 1024, "cp", name + ":/outputs/.", "-");
            checked(archive);
            if (archive.stdoutTruncated()) throw new Failure("EXECUTION_OUTPUT_LIMIT");
            Map<String, byte[]> files = SandboxOutputArchive.read(archive.stdout());
            try { new ExecutionOutputValidator(json).validate(request.outputs(), files); }
            catch (IllegalArgumentException invalid) { throw new Failure("EXECUTION_OUTPUT_INVALID"); }
            result = new Result(true, null, execution.exitCode(), false, string(execution.stdout()), string(execution.stderr()),
                execution.stdoutTruncated(), execution.stderrTruncated(), imageId, RUNTIME_VERSION, files);
        } catch (Failure safe) {
            result = failure(safe.code, imageId, execution, null);
        } catch (InterruptedException stopped) {
            interrupted = true;
            result = failure("EXECUTION_INTERRUPTED", imageId, execution, null);
        } catch (IOException | RuntimeException unsafe) {
            result = failure("SANDBOX_UNAVAILABLE", imageId, execution, null);
        } finally {
            // Even a timed-out create can have produced a container. Always remove the trusted preselected name.
            if (staging != null) {
                try {
                    var removed = direct(staging, Duration.ofSeconds(10), 1024, "rm", "--force", "--volumes", name);
                    // Missing container is harmless. Other failures retain a fail-closed result below.
                    if (removed.timedOut() || (removed.exitCode() != 0 &&
                        !string(removed.stderr()).strip().equals("Error response from daemon: No such container: " + name)))
                        result = failure("SANDBOX_CLEANUP_FAILED", imageId, execution, null);
                } catch (IOException failed) { result = failure("SANDBOX_CLEANUP_FAILED", imageId, execution, null); }
                catch (InterruptedException stopped) {
                    interrupted = true;
                    result = failure("SANDBOX_CLEANUP_FAILED", imageId, execution, null);
                }
                deleteStaging(staging);
            }
            if (interrupted) Thread.currentThread().interrupt();
        }
        return result;
    }

    private void stage(Request request, Path inputs, Path source) throws IOException {
        List<Map<String, Object>> manifestInputs = new ArrayList<>();
        for (Input input : request.inputs()) {
            byte[] bytes = input.bytes();
            try {
                if (!HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes)).equals(input.sha256()))
                    throw new Failure("SANDBOX_INPUT_INVALID");
            } catch (java.security.NoSuchAlgorithmException impossible) { throw new IllegalStateException(impossible); }
            writeReadonly(inputs.resolve(input.filename()), bytes);
            manifestInputs.add(Map.of("sourceVersionId", input.sourceVersionId().toString(), "format", input.format(),
                "file", "/inputs/" + input.filename(), "sha256", input.sha256()));
        }
        var manifestOutputs = request.outputs().stream().map(output -> Map.of("name", output.name(), "kind", output.kind().name())).toList();
        writeReadonly(source.resolve("manifest.json"), json.writeValueAsBytes(Map.of("schemaVersion", "1.0", "inputs", manifestInputs, "outputs", manifestOutputs)));
        writeReadonly(source.resolve("code.py"), request.code().getBytes(StandardCharsets.UTF_8));
        Files.setPosixFilePermissions(inputs, PosixFilePermissions.fromString("r-xr-xr-x"));
        Files.setPosixFilePermissions(source, PosixFilePermissions.fromString("r-xr-xr-x"));
    }
    private static void writeReadonly(Path path, byte[] bytes) throws IOException {
        Files.write(path, bytes, StandardOpenOption.CREATE_NEW);
        Files.setPosixFilePermissions(path, PosixFilePermissions.fromString("r--r--r--"));
    }
    private DockerCommands.Reply command(Path staging, long deadline, int maxBytes, String... args) throws IOException, InterruptedException {
        long remaining = deadline - System.nanoTime();
        if (remaining <= 0) throw new Failure("EXECUTION_TIMEOUT");
        return direct(staging, Duration.ofNanos(remaining), maxBytes, args);
    }
    private DockerCommands.Reply direct(Path staging, Duration timeout, int maxBytes, String... args) throws IOException, InterruptedException {
        var command = new ArrayList<>(List.of("docker", "--host", "unix://" + properties.getSocketPath(),
            "--config", staging.resolve("docker-config").toString()));
        command.addAll(List.of(args));
        return docker.execute(List.copyOf(command), timeout, maxBytes, LOG_LIMIT);
    }
    private static void checked(DockerCommands.Reply reply) {
        if (reply.timedOut()) throw new Failure("EXECUTION_TIMEOUT");
        if (reply.exitCode() != 0) throw new Failure("SANDBOX_UNAVAILABLE");
    }
    private static String string(byte[] bytes) { return new String(bytes, StandardCharsets.UTF_8); }
    private static Result failure(String code, String image, DockerCommands.Reply execution, Integer exitCode) {
        return new Result(false, code, execution == null ? exitCode : Integer.valueOf(execution.exitCode()), "EXECUTION_TIMEOUT".equals(code),
            execution == null ? "" : string(execution.stdout()), execution == null ? "" : string(execution.stderr()),
            execution != null && execution.stdoutTruncated(), execution != null && execution.stderrTruncated(), image, RUNTIME_VERSION, Map.of());
    }
    private static void deleteStaging(Path staging) {
        try (var files = Files.walk(staging)) {
            files.filter(path -> Files.isDirectory(path, LinkOption.NOFOLLOW_LINKS)).forEach(path -> {
                try { Files.setPosixFilePermissions(path, PosixFilePermissions.fromString("rwx------")); }
                catch (IOException ignored) { /* Best effort after forced container removal. */ }
            });
        } catch (IOException ignored) { /* Continue removing the files we can access. */ }
        try (var files = Files.walk(staging)) {
            files.sorted(Comparator.reverseOrder()).forEach(path -> {
                try {
                    if (Files.isDirectory(path, LinkOption.NOFOLLOW_LINKS))
                        Files.setPosixFilePermissions(path, PosixFilePermissions.fromString("rwx------"));
                    Files.deleteIfExists(path);
                } catch (IOException ignored) { /* No generated code can write into these readonly host mounts. */ }
            });
        } catch (IOException ignored) { /* Staging has restrictive permissions and contains no host credentials. */ }
    }
    static final class Failure extends RuntimeException {
        final String code;
        Failure(String code) { super(code); this.code = code; }
    }
}
