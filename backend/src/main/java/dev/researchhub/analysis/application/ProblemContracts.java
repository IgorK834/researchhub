package dev.researchhub.analysis.application;

import dev.researchhub.ai.application.GenerationContracts.*;
import dev.researchhub.shared.math.MathAst;

import tools.jackson.databind.JsonNode;

import java.time.Instant;
import java.util.*;

/** v2 PROBLEM has no source IDs; DATASET continues to use the v1 contracts. */
public final class ProblemContracts {
    private ProblemContracts() {}

    public static final Set<String> UNITS =
            Set.of(
                    "1", "m", "cm", "km", "s", "ms", "kg", "g", "m/s", "m/s^2", "N", "J", "Pa",
                    "rad", "deg", "A", "mA", "V", "ohm", "kohm", "W", "mW");

    public record Parameter(String symbol, String value, String unit) {
        public Parameter {
            ProblemContracts.symbol(symbol);
            if (value != null) decimal(value);
            ProblemContracts.unit(unit);
        }
    }

    public record Unknown(String symbol, String unit) {
        public Unknown {
            ProblemContracts.symbol(symbol);
            ProblemContracts.unit(unit);
        }
    }

    public record Output(String name, String kind, JsonNode expression, String unit) {
        public Output {
            text(name, 80);
            require(name.matches("[A-Za-z][A-Za-z0-9-]{0,79}"));
            require(Set.of("EVALUATE", "SOLVE").contains(kind));
            if (expression != null) {
                MathAst.notation(expression);
                expression = expression.deepCopy();
            }
            ProblemContracts.unit(unit);
        }
    }

    public record Plot(String parameter, String start, String end, int points, String output) {
        public Plot {
            symbol(parameter);
            decimal(start);
            decimal(end);
            require(points >= 2 && points <= 201);
            text(output, 80);
            require(new java.math.BigDecimal(start).compareTo(new java.math.BigDecimal(end)) < 0);
        }
    }

    public record Problem(
            String statement,
            List<Parameter> parameters,
            List<Unknown> unknowns,
            String domain,
            List<Output> expectedOutputs,
            List<String> assumptions,
            Plot plot) {
        public Problem {
            text(statement, 4000);
            parameters = items(parameters, 20);
            unknowns = items(unknowns, 1);
            expectedOutputs = items(expectedOutputs, 8);
            assumptions = items(assumptions, 12);
            assumptions.forEach(s -> text(s, 500));
            require(domain == null || domain.equals("REAL"));
            require(
                    parameters.stream().map(Parameter::symbol).distinct().count()
                            == parameters.size());
            var parameterNames =
                    parameters.stream()
                            .map(Parameter::symbol)
                            .collect(java.util.stream.Collectors.toSet());
            require(unknowns.stream().noneMatch(u -> parameterNames.contains(u.symbol())));
            require(
                    expectedOutputs.stream().map(Output::name).distinct().count()
                            == expectedOutputs.size());
        }
    }

    public record Origin(UUID documentId, UUID contextId, UUID conversationId, UUID messageId) {
        public Origin {
            require(documentId != null && contextId != null);
            require((conversationId == null) == (messageId == null));
        }
    }

    public record Create(
            String schemaVersion,
            String workload,
            UUID clientRequestId,
            String userPrompt,
            Problem problem,
            Origin origin,
            UUID parentAnalysisId) {
        public Create {
            require(
                    "2.0".equals(schemaVersion)
                            && "PROBLEM".equals(workload)
                            && clientRequestId != null
                            && problem != null);
            text(userPrompt, 4000);
        }
    }

    public record Snapshot(
            String schemaVersion,
            Problem problem,
            JsonNode origin,
            String inputHash,
            String templateId,
            String templateHash) {
        public Snapshot {
            require("2.0".equals(schemaVersion) && problem != null);
            hash(inputHash);
            text(templateId, 128);
            hash(templateHash);
        }
    }

    public record Plan(
            String schemaVersion,
            String workload,
            String problemHash,
            String summary,
            List<Output> outputs,
            List<String> assumptions,
            List<String> warnings,
            List<String> clarifications) {
        public Plan {
            require("2.0".equals(schemaVersion) && "PROBLEM".equals(workload));
            hash(problemHash);
            text(summary, 2000);
            outputs = items(outputs, 8);
            assumptions = notes(assumptions);
            warnings = notes(warnings);
            clarifications = notes(clarifications);
        }
    }

    public record PlanningRequest(
            String schemaVersion,
            UUID analysisId,
            Request request,
            Problem problem,
            String problemHash) {
        public PlanningRequest {
            require(
                    "2.0".equals(schemaVersion)
                            && analysisId != null
                            && request != null
                            && problem != null);
            hash(problemHash);
        }
    }

    public record Audit(
            PlanningRequest request, AnalysisContracts.Candidate candidate, Instant createdAt) {}

    public record Analysis(
            String schemaVersion,
            String workload,
            UUID id,
            UUID workspaceId,
            UUID createdBy,
            String userPrompt,
            String status,
            Snapshot snapshot,
            Plan plan,
            Audit audit,
            List<String> missing,
            UUID parentAnalysisId,
            Instant createdAt) {}

    public record Verification(
            String status,
            String inputHash,
            String planHash,
            String candidateHash,
            String imageId,
            String runtimeVersion,
            JsonNode receipt) {}

    public record Execution(
            UUID id,
            UUID analysisId,
            String status,
            String failureCode,
            Instant createdAt,
            Instant completedAt,
            String imageId,
            String runtimeVersion,
            String inputHash,
            String planHash,
            JsonNode result,
            Verification verification,
            String computationStatus,
            @com.fasterxml.jackson.annotation.JsonInclude(com.fasterxml.jackson.annotation.JsonInclude.Include.NON_NULL)
            SolutionContracts.Bundle solution) {
        public Execution(UUID id,UUID analysisId,String status,String failureCode,Instant createdAt,Instant completedAt,
                         String imageId,String runtimeVersion,String inputHash,String planHash,JsonNode result,Verification verification,String computationStatus) {
            this(id,analysisId,status,failureCode,createdAt,completedAt,imageId,runtimeVersion,inputHash,planHash,result,verification,computationStatus,null);
        }
        public Execution(
                UUID id,
                UUID analysisId,
                String status,
                String failureCode,
                Instant createdAt,
                Instant completedAt,
                String imageId,
                String runtimeVersion,
                String inputHash,
                String planHash,
                JsonNode result,
                Verification verification) {
            this(
                    id,
                    analysisId,
                    status,
                    failureCode,
                    createdAt,
                    completedAt,
                    imageId,
                    runtimeVersion,
                    inputHash,
                    planHash,
                    result,
                    verification,
                    status.equals("SUCCEEDED")
                            ? "SUCCEEDED"
                            : status.equals("FAILED") ? "FAILED" : "NOT_STARTED");
        }
    }

    public static List<String> missing(Problem p) {
        var result = new ArrayList<String>();
        if (p.domain() == null) result.add("Specify the REAL domain.");
        for (var v : p.parameters()) {
            if (v.value() == null)
                result.add("Provide a canonical decimal value for " + v.symbol() + ".");
            if (v.unit() == null)
                result.add("Specify the unit of " + v.symbol() + " (1 for dimensionless).");
        }
        for (var u : p.unknowns())
            if (u.unit() == null) result.add("Specify the unit of " + u.symbol() + ".");
        if (p.expectedOutputs().isEmpty())
            result.add("Specify the expected calculation and its formula.");
        for (var o : p.expectedOutputs()) {
            if (o.expression() == null) result.add("Specify the formula for " + o.name() + ".");
            if (o.unit() == null) result.add("Specify the output unit for " + o.name() + ".");
            if (o.kind().equals("SOLVE") && p.unknowns().size() != 1)
                result.add("Specify exactly one unknown for equation solving.");
        }
        var declared = new HashSet<String>();
        p.parameters().forEach(v -> declared.add(v.symbol()));
        p.unknowns().forEach(v -> declared.add(v.symbol()));
        var referenced = new TreeSet<String>();
        for (var o : p.expectedOutputs())
            if (o.expression() != null) collectSymbols(o.expression(), referenced);
        referenced.removeAll(declared);
        for (String symbol : referenced)
            result.add("Declare a parameter value/unit or an unknown for " + symbol + ".");
        return List.copyOf(result);
    }

    private static void collectSymbols(JsonNode n, Set<String> names) {
        if (n.path("op").asString().equals("symbol")) names.add(n.path("name").asString());
        for (var field : n.properties()) {
            var v = field.getValue();
            if (v.isObject()) collectSymbols(v, names);
            else if (v.isArray()) for (var child : v) collectSymbols(child, names);
        }
    }

    static void symbol(String value) {
        require(value != null && value.matches("[A-Za-z][A-Za-z0-9]{0,15}"));
    }

    static void decimal(String value) {
        require(
                value != null
                        && value.length() <= 40
                        && value.matches("-?(0|[1-9][0-9]*)(\\.[0-9]+)?")
                        && !value.equals("-0")
                        && !value.matches(".*\\.[0-9]*0"));
    }

    static void unit(String unit) {
        require(unit == null || UNITS.contains(unit));
    }

    static void hash(String v) {
        require(v != null && v.matches("[a-f0-9]{64}"));
    }

    static void text(String v, int max) {
        require(v != null && !v.isBlank() && v.length() <= max);
    }

    static <T> List<T> items(List<T> v, int max) {
        require(v != null && v.size() <= max && v.stream().noneMatch(Objects::isNull));
        return List.copyOf(v);
    }

    static List<String> notes(List<String> v) {
        v = items(v, 12);
        v.forEach(s -> text(s, 500));
        return v;
    }

    static void require(boolean ok) {
        if (!ok) throw new IllegalArgumentException("Invalid problem contract");
    }
}
