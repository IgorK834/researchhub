package dev.researchhub.analysis.infrastructure;

import dev.researchhub.analysis.application.SandboxRunner.*;
import dev.researchhub.analysis.application.AnalysisContracts.OutputKind;
import dev.researchhub.analysis.application.ExecutionOutputValidator;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import tools.jackson.databind.json.JsonMapper;
import static org.junit.jupiter.api.Assertions.*;

/** Opt-in acceptance against the locally built fixed image, never a substitute for unit failures/cleanup checks. */
@EnabledIfEnvironmentVariable(named = "ANALYSIS_SANDBOX_TESTS", matches = "true")
class DockerSandboxRunnerIntegrationTest {
    final JsonMapper json = JsonMapper.builder().findAndAddModules().build();
    DockerSandboxRunner runner(Duration timeout) {
        var properties = new SandboxProperties(); properties.setEnabled(true); properties.setTimeout(timeout);
        properties.setSocketPath(System.getenv().getOrDefault("ANALYSIS_SANDBOX_SOCKET_PATH", "/var/run/docker.sock"));
        properties.setMemoryMiB(128);
        return new DockerSandboxRunner(properties, json);
    }
    Request request(String code) {
        byte[] bytes = "a,b\n1,2\n3,4\n".getBytes(StandardCharsets.UTF_8);
        return new Request(UUID.randomUUID(), UUID.randomUUID(), code,
            List.of(new Input(UUID.randomUUID(), "CSV", bytes, ExecutionOutputValidator.sha256(bytes))), List.of(new Output("summary", OutputKind.TEXT)));
    }
    String success() {
        return "import json\nfrom pathlib import Path\nPath('/outputs/result.json').write_text(json.dumps({'schemaVersion':'1.0','outputs':[{'name':'summary','kind':'TEXT','text':'healthy'}]}))";
    }
    @Test void exactImmutableInputMountReadOnlyNoSecretsAndNetworking() {
        String code = """
            import json, os, socket
            from pathlib import Path
            manifest=json.loads(Path('/execution/manifest.json').read_text())
            assert set(p.name for p in Path('/inputs').iterdir())=={Path(manifest['inputs'][0]['file']).name}
            assert Path(manifest['inputs'][0]['file']).read_bytes()==b'a,b\\n1,2\\n3,4\\n'
            assert not Path('/var/run/docker.sock').exists()
            assert not Path('/Users').exists()
            assert os.getuid()==65532
            assert not any(k.startswith(('DB_', 'FOUNDRY_', 'AZURE_', 'AI_WORKER_')) for k in os.environ)
            for path in ['/execution/code.py','/inputs/'+Path(manifest['inputs'][0]['file']).name,'/root/secret']:
                try:
                    Path(path).write_text('bad')
                    raise AssertionError('writable')
                except OSError:
                    pass
            try:
                socket.create_connection(('1.1.1.1', 443), timeout=1)
                raise AssertionError('network')
            except OSError:
                pass
            """ + success();
        Result result = runner(Duration.ofSeconds(30)).run(request(code));
        assertTrue(result.successful(), result.failureCode() + ":" + result.stderr());
        assertTrue(result.imageId().matches("sha256:[a-f0-9]{64}"));
        assertEquals("healthy", json.readTree(result.files().get("result.json")).path("outputs").get(0).path("text").asString());
    }
    @Test void loopTimeoutAndMemoryLimitDoNotPoisonTheNextRun() {
        var launcher = runner(Duration.ofSeconds(3));
        Result loop = launcher.run(request("while True: pass"));
        assertEquals("EXECUTION_TIMEOUT", loop.failureCode()); assertTrue(loop.timedOut());
        Result healthy = runner(Duration.ofSeconds(30)).run(request(success()));
        assertTrue(healthy.successful(), healthy.failureCode() + ":" + healthy.stderr());
        Result memory = runner(Duration.ofSeconds(15)).run(request("chunks=[]\nwhile True: chunks.append(bytearray(16*1024*1024))"));
        assertFalse(memory.successful()); assertEquals("EXECUTION_RESOURCE_LIMIT", memory.failureCode(), memory.stderr());
        healthy = runner(Duration.ofSeconds(30)).run(request(success()));
        assertTrue(healthy.successful(), healthy.failureCode());
    }
    @Test void nonzeroAndFilesystemEscapesAreControlledFailures() {
        Result nonzero = runner(Duration.ofSeconds(15)).run(request("import sys\nsys.exit(7)"));
        assertEquals("EXECUTION_FAILED", nonzero.failureCode()); assertEquals(7, nonzero.exitCode());
        for (String code : List.of("from pathlib import Path\nPath('/outputs/result.json').symlink_to('/execution/manifest.json')",
            success() + "\nfrom pathlib import Path\nPath('/outputs/unlisted').write_text('bad')",
            "from pathlib import Path\nPath('/outputs/result.json').write_bytes(b'x'*(20*1024*1024))")) {
            Result result = runner(Duration.ofSeconds(15)).run(request(code));
            assertFalse(result.successful()); assertTrue(result.files().isEmpty());
            assertTrue(Set.of("EXECUTION_FAILED", "EXECUTION_OUTPUT_INVALID", "EXECUTION_RESOURCE_LIMIT").contains(result.failureCode()), result.failureCode());
        }
        Result healthy = runner(Duration.ofSeconds(30)).run(request(success())); assertTrue(healthy.successful(), healthy.failureCode());
    }
    @Test void stdoutAndStderrAreCappedAndDrained() {
        Result result = runner(Duration.ofSeconds(30)).run(request("import sys\nsys.stdout.write('x'*200000)\nsys.stderr.write('y'*200000)\n" + success()));
        assertTrue(result.successful(), result.failureCode()); assertTrue(result.stdoutTruncated()); assertTrue(result.stderrTruncated());
        assertEquals(65536, result.stdout().getBytes(StandardCharsets.UTF_8).length);
        assertEquals(65536, result.stderr().getBytes(StandardCharsets.UTF_8).length);
    }
}
