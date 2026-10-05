package dev.researchhub.analysis.infrastructure;

import dev.researchhub.analysis.application.SandboxRunner.*;
import dev.researchhub.analysis.application.AnalysisContracts.OutputKind;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.time.Duration;
import java.util.*;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;
import static org.junit.jupiter.api.Assertions.*;

class DockerSandboxRunnerTest {
    static final String IMAGE_ID = "sha256:" + "a".repeat(64);
    final JsonMapper json = JsonMapper.builder().findAndAddModules().build();
    final SandboxProperties properties = new SandboxProperties();
    Request request() {
        return new Request(UUID.randomUUID(), UUID.randomUUID(), "print('generated code')",
            List.of(new Input(UUID.randomUUID(), "CSV", new byte[0], dev.researchhub.analysis.application.ExecutionOutputValidator.sha256(new byte[0]))),
            List.of(new Output("summary", OutputKind.TEXT)));
    }
    DockerSandboxRunner runner(DockerCommands commands) { properties.setEnabled(true); return new DockerSandboxRunner(properties, json, commands); }
    static byte[] validResult() { return "{\"schemaVersion\":\"1.0\",\"outputs\":[{\"name\":\"summary\",\"kind\":\"TEXT\",\"text\":\"done\"}]}".getBytes(StandardCharsets.UTF_8); }
    static DockerCommands.Reply reply(int code, byte[] out) { return new DockerCommands.Reply(code, false, out, new byte[0], false, false); }
    final class Fake implements DockerCommands {
        final List<List<String>> calls = new ArrayList<>();
        final Map<String, Reply> replies = new HashMap<>();
        String ioFailure, interruption;
        String savedVersion="1.1.0";
        Path staging;
        Request expected;
        @Override public Reply execute(List<String> command, Duration timeout, int stdoutLimit, int stderrLimit) throws IOException, InterruptedException {
            calls.add(command);
            assertEquals("docker", command.getFirst()); assertEquals("--host", command.get(1));
            assertTrue(command.get(2).startsWith("unix:///")); assertEquals("--config", command.get(3));
            assertTrue(timeout.isPositive()); assertEquals(DockerSandboxRunner.LOG_LIMIT, stderrLimit);
            staging = Path.of(command.get(4)).getParent();
            String operation = command.get(5);
            if (operation.equals(ioFailure)) throw new IOException("host secret token");
            if (operation.equals(interruption)) throw new InterruptedException();
            if (operation.equals("create") && expected != null) {
                assertEquals(expected.code(), Files.readString(staging.resolve("execution/code.py")));
                var manifest = json.readTree(Files.readAllBytes(staging.resolve("execution/manifest.json")));
                assertEquals("1.0", manifest.path("schemaVersion").asString());
                assertEquals("/inputs/" + expected.inputs().getFirst().filename(), manifest.path("inputs").get(0).path("file").asString());
                assertEquals(Set.of(expected.inputs().getFirst().filename()), Files.list(staging.resolve("inputs")).map(p -> p.getFileName().toString()).collect(java.util.stream.Collectors.toSet()));
            }
            if (replies.containsKey(operation)) return replies.get(operation);
            if (operation.equals("image") && command.stream().anyMatch(v -> v.contains("org.opencontainers.image.version")))
                return reply(0,savedVersion.getBytes(StandardCharsets.UTF_8));
            if (operation.equals("image")) return reply(0, (IMAGE_ID + "\n").getBytes(StandardCharsets.UTF_8));
            if (operation.equals("exec")) return new Reply(0, false, "captured".getBytes(), "diagnostic".getBytes(), true, true);
            if (operation.equals("cp")) return reply(0, tar("result.json", '0', validResult()));
            return reply(0, new byte[0]);
        }
    }
    @Test void disabledDoesNotTouchDockerOrInputs() {
        Result result = new DockerSandboxRunner(properties, json, (a,b,c,d) -> { throw new AssertionError(); }).run(request());
        assertEquals("SANDBOX_DISABLED", result.failureCode()); assertTrue(result.files().isEmpty());
    }
    @Test void originalRerunUsesTheSavedDigestAndVersionAndNeverFallsBackToAnotherImage() {
        var standard=request();var identity=new dev.researchhub.analysis.application.ReproductionContracts.RuntimeIdentity(IMAGE_ID,"1.0.0");
        var request=new Request(standard.executionId(),standard.planId(),standard.code(),standard.inputs(),standard.outputs(),identity);
        Fake fake=new Fake();fake.savedVersion="1.0.0";var result=runner(fake).run(request);
        assertTrue(result.successful(),result.failureCode());assertEquals("1.0.0",result.runtimeVersion());
        assertEquals(IMAGE_ID,fake.calls.getFirst().getLast());assertFalse(fake.calls.getFirst().contains(DockerSandboxRunner.IMAGE));
        fake=new Fake();assertEquals("SANDBOX_UNAVAILABLE",runner(fake).run(request).failureCode());
        assertTrue(fake.calls.stream().noneMatch(c -> c.contains("create")));
        fake=new Fake();fake.replies.put("image",reply(0,("sha256:"+"b".repeat(64)).getBytes(StandardCharsets.UTF_8)));
        assertEquals("SANDBOX_UNAVAILABLE",runner(fake).run(request).failureCode());
        assertThrows(IllegalArgumentException.class,() -> new dev.researchhub.analysis.application.ReproductionContracts.RuntimeIdentity("image:latest","1"));
    }
    @Test void launchesOnlyTrustedImmutableImageAndCollectsBeforeCleanup() throws Exception {
        Fake fake = new Fake(); fake.expected = request();
        Result result = runner(fake).run(fake.expected);
        assertTrue(result.successful(), result.failureCode()); assertEquals(IMAGE_ID, result.imageId());
        assertEquals("1.1.0", result.runtimeVersion()); assertEquals("captured", result.stdout()); assertTrue(result.stderrTruncated());
        assertArrayEquals(validResult(), result.files().get("result.json"));
        var create = fake.calls.stream().filter(c -> c.get(5).equals("create")).findFirst().orElseThrow();
        for (String restriction : List.of("none", "--read-only", "65532:65532", "--cap-drop", "ALL", "no-new-privileges:true", "--memory-swap", "--pids-limit", "--cpus", "--pull", "never", IMAGE_ID))
            assertTrue(create.contains(restriction), restriction);
        assertTrue(create.stream().anyMatch(v -> v.contains("dst=/inputs,readonly")));
        assertTrue(create.stream().anyMatch(v -> v.contains("dst=/outputs") && v.contains("type=tmpfs") && v.contains("size=16777216") && v.contains("nr_inodes=128")));
        assertTrue(fake.calls.getLast().contains("--volumes"));
        assertFalse(create.contains(fake.expected.code())); assertFalse(create.contains("--privileged"));
        assertEquals(List.of("image", "create", "start", "exec", "pause", "cp", "rm"), fake.calls.stream().map(c -> c.get(5)).toList());
        assertFalse(Files.exists(fake.staging));
        byte[] returned = result.files().get("result.json"); returned[0] = 0;
        assertArrayEquals(validResult(), result.files().get("result.json"));
        assertThrows(UnsupportedOperationException.class, () -> result.files().put("evil", returned));
    }
    @Test void structuredFailuresNeverExposeHostDockerDetailsAndAlwaysRemove() {
        for (String operation : List.of("image", "create", "start", "pause", "cp")) {
            Fake fake = new Fake(); fake.replies.put(operation, new DockerCommands.Reply(1, false, new byte[0], "host secret".getBytes(), false, false));
            Result result = runner(fake).run(request());
            assertEquals("SANDBOX_UNAVAILABLE", result.failureCode()); assertFalse(result.stderr().contains("host secret"));
            assertEquals("rm", fake.calls.getLast().get(5)); assertFalse(Files.exists(fake.staging));
        }
        for (int exit : List.of(1, 65, 137)) {
            Fake fake = new Fake(); fake.replies.put("exec", reply(exit, "partial".getBytes()));
            Result result = runner(fake).run(request());
            assertEquals(exit == 137 ? "EXECUTION_RESOURCE_LIMIT" : exit == 65 ? "EXECUTION_OUTPUT_INVALID" : "EXECUTION_FAILED", result.failureCode());
            assertEquals(exit, result.exitCode()); assertEquals("partial", result.stdout()); assertTrue(result.files().isEmpty());
            assertEquals("rm", fake.calls.getLast().get(5));
        }
    }
    @Test void timeoutsStartupAndExecutionAndIoFailuresAreBounded() {
        for (String operation : List.of("image", "create", "start", "exec", "pause", "cp")) {
            Fake fake = new Fake(); fake.replies.put(operation, new DockerCommands.Reply(-1, true, "partial".getBytes(), new byte[0], false, false));
            Result result = runner(fake).run(request());
            assertEquals("EXECUTION_TIMEOUT", result.failureCode()); assertTrue(result.timedOut());
            assertEquals("rm", fake.calls.getLast().get(5));
        }
        Fake fake = new Fake(); fake.ioFailure = "create";
        assertEquals("SANDBOX_UNAVAILABLE", runner(fake).run(request()).failureCode());
        fake = new Fake(); fake.interruption = "exec";
        assertEquals("EXECUTION_INTERRUPTED", runner(fake).run(request()).failureCode());
        assertTrue(Thread.interrupted()); assertEquals("rm", fake.calls.getLast().get(5));
    }
    @Test void rejectsMalformedIdentityInputsArchivesAndManifest() {
        Fake fake = new Fake(); fake.replies.put("image", reply(0, "researchhub:latest".getBytes()));
        assertEquals("SANDBOX_UNAVAILABLE", runner(fake).run(request()).failureCode());
        Request bad = new Request(UUID.randomUUID(), UUID.randomUUID(), "pass", List.of(new Input(UUID.randomUUID(), "CSV", new byte[]{1}, "a".repeat(64))), request().outputs());
        fake = new Fake(); assertEquals("SANDBOX_INPUT_INVALID", runner(fake).run(bad).failureCode());
        assertEquals(List.of("rm"), fake.calls.stream().map(c -> c.get(5)).toList());
        for (byte[] data : List.of(new byte[1], tar("result.json", '0', "{}".getBytes()), tar("result.json", '2', validResult()))) {
            fake = new Fake(); fake.replies.put("cp", reply(0, data));
            assertEquals("EXECUTION_OUTPUT_INVALID", runner(fake).run(request()).failureCode());
        }
        fake = new Fake(); fake.replies.put("cp", new DockerCommands.Reply(0, false, new byte[0], new byte[0], true, false));
        assertEquals("EXECUTION_OUTPUT_LIMIT", runner(fake).run(request()).failureCode());
    }
    @Test void cleanupFailureNeverReportsSuccess() {
        Fake fake = new Fake(); fake.ioFailure = "rm";
        assertEquals("SANDBOX_CLEANUP_FAILED", runner(fake).run(request()).failureCode());
        fake = new Fake(); fake.replies.put("rm", reply(1, new byte[0]));
        assertEquals("SANDBOX_CLEANUP_FAILED", runner(fake).run(request()).failureCode());
        fake = new Fake(); fake.interruption = "rm";
        assertEquals("SANDBOX_CLEANUP_FAILED", runner(fake).run(request()).failureCode()); assertTrue(Thread.interrupted());
    }
    static byte[] tar(String name, char type, byte[] content) {
        byte[] bytes = new byte[512 + (content.length + 511) / 512 * 512 + 1024];
        byte[] nameBytes = name.getBytes(StandardCharsets.US_ASCII); System.arraycopy(nameBytes, 0, bytes, 0, Math.min(100, nameBytes.length));
        byte[] size = String.format("%011o", content.length).getBytes(StandardCharsets.US_ASCII); System.arraycopy(size, 0, bytes, 124, size.length);
        bytes[156] = (byte) type; Arrays.fill(bytes, 148, 156, (byte) ' ');
        int checksum = 0; for (int i = 0; i < 512; i++) checksum += Byte.toUnsignedInt(bytes[i]);
        byte[] sum = String.format("%06o", checksum).getBytes(StandardCharsets.US_ASCII); System.arraycopy(sum, 0, bytes, 148, sum.length); bytes[154] = 0;
        System.arraycopy(content, 0, bytes, 512, content.length); return bytes;
    }
}
