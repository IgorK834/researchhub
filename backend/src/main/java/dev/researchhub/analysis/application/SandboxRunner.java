package dev.researchhub.analysis.application;

import java.util.*;

/** Trusted launcher port. There are deliberately no Docker options, host paths, images or environment fields. */
public interface SandboxRunner {
    String IMAGE = "researchhub-sandbox:1.0.0";
    Result run(Request request);

    record Input(UUID sourceVersionId, String format, byte[] bytes, String sha256) {
        public Input {
            if (sourceVersionId == null || !Set.of("CSV", "XLSX").contains(format) || bytes == null
                || bytes.length > 50 * 1024 * 1024 || sha256 == null || !sha256.matches("[a-f0-9]{64}"))
                throw new IllegalArgumentException("Invalid sandbox input");
            bytes = bytes.clone();
        }
        @Override public byte[] bytes() { return bytes.clone(); }
        public String filename() { return sourceVersionId + (format.equals("CSV") ? ".csv" : ".xlsx"); }
    }
    record Output(String name, AnalysisContracts.OutputKind kind) {
        public Output {
            if (name == null || name.isBlank() || name.length() > 100 || kind == null)
                throw new IllegalArgumentException("Invalid sandbox output");
        }
    }
    record Request(UUID executionId, UUID planId, String code, List<Input> inputs, List<Output> outputs) {
        public Request {
            if (executionId == null || planId == null || code == null || code.isBlank() || code.length() > 32000
                || inputs == null || inputs.isEmpty() || inputs.size() > 5 || outputs == null || outputs.isEmpty()
                || outputs.size() > 10 || inputs.stream().anyMatch(Objects::isNull) || outputs.stream().anyMatch(Objects::isNull)
                || inputs.stream().map(Input::sourceVersionId).distinct().count() != inputs.size()
                || outputs.stream().map(Output::name).distinct().count() != outputs.size())
                throw new IllegalArgumentException("Invalid sandbox request");
            inputs = List.copyOf(inputs); outputs = List.copyOf(outputs);
        }
    }
    record Result(boolean successful, String failureCode, Integer exitCode, boolean timedOut,
                  String stdout, String stderr, boolean stdoutTruncated, boolean stderrTruncated,
                  String imageId, String runtimeVersion, Map<String, byte[]> files) {
        public Result {
            var copy = new LinkedHashMap<String, byte[]>();
            files.forEach((name, bytes) -> copy.put(name, bytes.clone()));
            files = Collections.unmodifiableMap(copy);
        }
        @Override public Map<String, byte[]> files() {
            var copy = new LinkedHashMap<String, byte[]>();
            files.forEach((name, bytes) -> copy.put(name, bytes.clone()));
            return Collections.unmodifiableMap(copy);
        }
    }
}
