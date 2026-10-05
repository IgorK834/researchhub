package dev.researchhub.analysis.infrastructure;

import java.nio.charset.StandardCharsets;
import java.util.*;

/** Reads Docker's tar stream into bounded memory. It never extracts paths onto the application filesystem. */
final class SandboxOutputArchive {
    private SandboxOutputArchive() {}
    static Map<String, byte[]> read(byte[] archive) {
        Map<String, byte[]> files = new LinkedHashMap<>();
        long total = 0;
        int offset = 0;
        boolean ended = false;
        while (offset + 512 <= archive.length) {
            byte[] header = Arrays.copyOfRange(archive, offset, offset + 512);
            offset += 512;
            if (allZero(header)) { ended = true; break; }
            long checksum = octal(header, 148, 8);
            long actual = 0;
            for (int i = 0; i < 512; i++) actual += i >= 148 && i < 156 ? 32 : Byte.toUnsignedInt(header[i]);
            require(checksum == actual);
            String name = field(header, 0, 100);
            String prefix = field(header, 345, 155);
            if (!prefix.isEmpty()) name = prefix + "/" + name;
            long size = octal(header, 124, 12);
            require(size <= DockerSandboxRunner.OUTPUT_LIMIT && size <= archive.length - offset);
            int padded = (int) ((size + 511) / 512 * 512);
            require(padded <= archive.length - offset);
            int type = header[156];
            require(field(header, 157, 100).isEmpty()); // hardlinks and symlinks cannot hide under a regular file header
            byte[] data = Arrays.copyOfRange(archive, offset, offset + (int) size);
            offset += padded;
            if (type == 'x' || type == 'g') {
                // Docker may attach fractional timestamps. Refuse all path/link/size/xattr overrides.
                require(size <= 4096);
                checkPax(data);
                continue;
            }
            if (type == '5') {
                require(size == 0 && Set.of(".", "./", "outputs", "outputs/").contains(name));
                continue;
            }
            require(type == 0 || type == '0');
            if (name.startsWith("./")) name = name.substring(2);
            if (name.startsWith("outputs/")) name = name.substring(8);
            require(name.matches("[A-Za-z0-9][A-Za-z0-9_.-]{0,100}") && !name.equals(".") && !name.equals(".."));
            require(files.size() < 11 && !files.containsKey(name));
            if (size > (name.equals("result.json") ? 1024 * 1024 : 8 * 1024 * 1024))
                throw new DockerSandboxRunner.Failure("EXECUTION_OUTPUT_LIMIT");
            total += size;
            if (total > DockerSandboxRunner.OUTPUT_LIMIT) throw new DockerSandboxRunner.Failure("EXECUTION_OUTPUT_LIMIT");
            files.put(name, data);
        }
        require(ended);
        while (offset < archive.length) require(archive[offset++] == 0);
        require(files.containsKey("result.json"));
        return Collections.unmodifiableMap(files);
    }
    private static void checkPax(byte[] data) {
        int offset = 0;
        while (offset < data.length) {
            int space = offset;
            while (space < data.length && data[space] != ' ') space++;
            require(space > offset && space < data.length && space - offset < 5);
            String digits = new String(data, offset, space - offset, StandardCharsets.US_ASCII);
            require(digits.matches("[0-9]+"));
            int length = Integer.parseInt(digits);
            require(length > space - offset + 2 && length <= data.length - offset && data[offset + length - 1] == '\n');
            String record = new String(data, space + 1, offset + length - space - 2, StandardCharsets.US_ASCII);
            require(record.matches("(mtime|atime|ctime)=-?[0-9]+(\\.[0-9]+)?"));
            offset += length;
        }
    }
    private static boolean allZero(byte[] bytes) {
        for (byte value : bytes) if (value != 0) return false;
        return true;
    }
    private static String field(byte[] bytes, int start, int length) {
        int end = start;
        while (end < start + length && bytes[end] != 0) end++;
        String value = new String(bytes, start, end - start, StandardCharsets.US_ASCII);
        require(value.chars().allMatch(c -> c >= 32 && c < 127));
        return value;
    }
    private static long octal(byte[] bytes, int start, int length) {
        String value = field(bytes, start, length).strip();
        require(!value.isEmpty() && value.matches("[0-7]{1,12}"));
        try { return Long.parseLong(value, 8); }
        catch (NumberFormatException invalid) { throw new DockerSandboxRunner.Failure("EXECUTION_OUTPUT_INVALID"); }
    }
    private static void require(boolean valid) {
        if (!valid) throw new DockerSandboxRunner.Failure("EXECUTION_OUTPUT_INVALID");
    }
}
