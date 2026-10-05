package dev.researchhub.analysis.infrastructure;

import java.nio.charset.StandardCharsets;
import java.util.*;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;
import static dev.researchhub.analysis.infrastructure.DockerSandboxRunnerTest.tar;

class SandboxOutputArchiveTest {
    @Test void permitsOnlyFlatRegularFilesAndRootDirectories() {
        for (String name : List.of("result.json", "./result.json", "outputs/result.json"))
            assertArrayEquals(new byte[]{1}, SandboxOutputArchive.read(tar(name, '0', new byte[]{1})).get("result.json"));
        byte[] root = tar("./", '5', new byte[0]); byte[] result = tar("result.json", '0', new byte[]{1});
        assertEquals(1, SandboxOutputArchive.read(concat(Arrays.copyOf(root, 512), result)).size());
        for (String path : List.of("../result.json", "/result.json", "nested/result.json", "outputs/../result.json", "././result.json", ".."))
            assertThrows(DockerSandboxRunner.Failure.class, () -> SandboxOutputArchive.read(tar(path, '0', new byte[0])));
        for (char type : new char[]{'1', '2', '3', '4', '6', 'L', 'K'})
            assertThrows(DockerSandboxRunner.Failure.class, () -> SandboxOutputArchive.read(tar("result.json", type, new byte[0])));
        assertThrows(DockerSandboxRunner.Failure.class, () -> SandboxOutputArchive.read(tar("nested/", '5', new byte[0])));
        assertThrows(DockerSandboxRunner.Failure.class, () -> SandboxOutputArchive.read(tar("chart.png", '0', new byte[0])));
    }
    @Test void rejectsDuplicatesBadChecksumTruncationAndExcessOutput() {
        byte[] result = tar("result.json", '0', new byte[]{1});
        assertThrows(DockerSandboxRunner.Failure.class, () -> SandboxOutputArchive.read(concat(Arrays.copyOf(result, 1024), result)));
        byte[] checksum = result.clone(); checksum[0] = '!';
        assertThrows(DockerSandboxRunner.Failure.class, () -> SandboxOutputArchive.read(checksum));
        assertThrows(DockerSandboxRunner.Failure.class, () -> SandboxOutputArchive.read(Arrays.copyOf(result, 514)));
        byte[] trailing = result.clone(); trailing[trailing.length - 1] = 1;
        assertThrows(DockerSandboxRunner.Failure.class, () -> SandboxOutputArchive.read(trailing));
        assertEquals("EXECUTION_OUTPUT_LIMIT", assertThrows(DockerSandboxRunner.Failure.class, () -> SandboxOutputArchive.read(tar("result.json", '0', new byte[1024*1024+1]))).code);
        assertEquals("EXECUTION_OUTPUT_LIMIT", assertThrows(DockerSandboxRunner.Failure.class, () -> SandboxOutputArchive.read(tar("x.png", '0', new byte[8*1024*1024+1]))).code);
    }
    @Test void acceptsTimestampPaxAndRejectsEveryPathOverride() {
        byte[] result = tar("result.json", '0', new byte[]{1});
        for (String key : List.of("mtime", "atime", "ctime", "path", "linkpath", "size", "SCHILY.xattr.secret")) {
            String value = key + "=123.123\n"; int length = value.length() + 3;
            String pax = length + " " + value;
            byte[] metadata = tar("PaxHeader/result.json", 'x', pax.getBytes(StandardCharsets.US_ASCII));
            byte[] merged = concat(Arrays.copyOf(metadata, 1024), result);
            if (Set.of("mtime", "atime", "ctime").contains(key)) assertEquals(1, SandboxOutputArchive.read(merged).size());
            else assertThrows(DockerSandboxRunner.Failure.class, () -> SandboxOutputArchive.read(merged));
        }
    }
    static byte[] concat(byte[] first, byte[] second) {
        byte[] combined = Arrays.copyOf(first, first.length + second.length); System.arraycopy(second, 0, combined, first.length, second.length); return combined;
    }
}
