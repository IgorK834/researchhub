package dev.researchhub.analysis.application;

import dev.researchhub.analysis.application.ProblemContracts.*;
import dev.researchhub.shared.math.MathAst;

import tools.jackson.databind.JsonNode;

import java.util.*;

/** Dimensions and references are checked before launch; no numerical evaluation in Java. */
public final class ProblemPlanValidator {
    private ProblemPlanValidator() {}

    public static int[] dimension(String unit) {
        return switch (unit) {
            case "1", "rad", "deg" -> new int[] {0, 0, 0, 0};
            case "m", "cm", "km" -> new int[] {1, 0, 0, 0};
            case "s", "ms" -> new int[] {0, 0, 1, 0};
            case "kg", "g" -> new int[] {0, 1, 0, 0};
            case "m/s" -> new int[] {1, 0, -1, 0};
            case "m/s^2" -> new int[] {1, 0, -2, 0};
            case "N" -> new int[] {1, 1, -2, 0};
            case "J" -> new int[] {2, 1, -2, 0};
            case "A", "mA" -> new int[] {0, 0, 0, 1};
            case "V" -> new int[] {2, 1, -3, -1};
            case "ohm", "kohm" -> new int[] {2, 1, -3, -2};
            case "W", "mW" -> new int[] {2, 1, -3, 0};
            case "Pa" -> new int[] {-1, 1, -2, 0};
            default -> throw new IllegalArgumentException("Unsupported unit");
        };
    }

    public static void validate(Problem p, Plan plan, String hash) {
        MathAst.require(
                plan.problemHash().equals(hash)
                        && plan.clarifications().isEmpty()
                        && !plan.outputs().isEmpty());
        MathAst.require(
                plan.outputs().equals(p.expectedOutputs())
                        && plan.assumptions().equals(p.assumptions()));
        var units = new HashMap<String, String>();
        p.parameters().forEach(v -> units.put(v.symbol(), v.unit()));
        p.unknowns().forEach(v -> units.put(v.symbol(), v.unit()));
        for (var o : plan.outputs()) {
            MathAst.notation(o.expression());
            cost(o.expression());
            MathAst.require(
                    (o.kind().equals("SOLVE"))
                            == o.expression().path("op").asString().equals("eq"));
            noNestedEquation(o.expression(), true);
            if (o.kind().equals("SOLVE"))
                MathAst.require(
                        degree(o.expression(), p.unknowns().getFirst().symbol()) >= 1
                                && degree(o.expression(), p.unknowns().getFirst().symbol()) <= 4);
            int[] d = dim(o.expression(), units);
            if (o.kind().equals("EVALUATE")) same(d, dimension(o.unit()));
            else same(d, dim(o.expression().path("right"), units));
        }
        if (p.plot() != null) {
            MathAst.require(
                    p.parameters().stream().anyMatch(v -> v.symbol().equals(p.plot().parameter())));
            MathAst.require(
                    plan.outputs().stream()
                            .anyMatch(
                                    o ->
                                            o.name().equals(p.plot().output())
                                                    && o.kind().equals("EVALUATE")));
        }
    }

    private static int cost(JsonNode n) {
        String op = n.path("op").asString();
        int result =
                switch (op) {
                    case "number" -> n.path("value").asString().length();
                    case "symbol" -> 1;
                    case "add", "mul" ->
                            iter(n.path("args")).stream()
                                    .mapToInt(ProblemPlanValidator::cost)
                                    .sum();
                    case "eq", "div" -> cost(n.path("left")) + cost(n.path("right"));
                    case "pow" ->
                            cost(n.path("base"))
                                    * Math.max(1, Math.abs(n.path("exponent").asInt()));
                    default -> cost(n.path("arg")) * 2;
                };
        MathAst.require(result <= 2048);
        return result;
    }

    private static void noNestedEquation(JsonNode n, boolean root) {
        MathAst.require(root || !n.path("op").asString().equals("eq"));
        for (var e : n.properties())
            if (e.getValue().isObject()) noNestedEquation(e.getValue(), false);
            else if (e.getValue().isArray()) for (var c : e.getValue()) noNestedEquation(c, false);
    }

    private static int degree(JsonNode n, String unknown) {
        String op = n.path("op").asString();
        return switch (op) {
            case "number" -> 0;
            case "symbol" -> n.path("name").asString().equals(unknown) ? 1 : 0;
            case "add", "eq" -> {
                var args =
                        op.equals("eq")
                                ? List.of(n.path("left"), n.path("right"))
                                : iter(n.path("args"));
                yield args.stream().mapToInt(a -> degree(a, unknown)).max().orElse(0);
            }
            case "mul" -> iter(n.path("args")).stream().mapToInt(a -> degree(a, unknown)).sum();
            case "div" -> {
                MathAst.require(degree(n.path("right"), unknown) == 0);
                yield degree(n.path("left"), unknown);
            }
            case "pow" -> {
                int d = degree(n.path("base"), unknown), e = n.path("exponent").asInt();
                MathAst.require(d == 0 || e >= 0);
                yield d * Math.max(0, e);
            }
            default -> {
                MathAst.require(degree(n.path("arg"), unknown) == 0);
                yield 0;
            }
        };
    }

    private static void same(int[] a, int[] b) {
        MathAst.require(Arrays.equals(a, b));
    }

    private static int[] dim(JsonNode n, Map<String, String> units) {
        String op = n.path("op").asString();
        return switch (op) {
            case "number" -> new int[] {0, 0, 0, 0};
            case "symbol" -> {
                String u = units.get(n.path("name").asString());
                MathAst.require(u != null);
                yield dimension(u);
            }
            case "add", "eq" -> {
                var args =
                        op.equals("eq")
                                ? List.of(n.path("left"), n.path("right"))
                                : iter(n.path("args"));
                int[] d = dim(args.getFirst(), units);
                for (var a : args) same(d, dim(a, units));
                yield d;
            }
            case "mul", "div" -> {
                int[] d = new int[4];
                var args =
                        op.equals("div")
                                ? List.of(n.path("left"), n.path("right"))
                                : iter(n.path("args"));
                for (int j = 0; j < args.size(); j++) {
                    var v = dim(args.get(j), units);
                    for (int k = 0; k < 4; k++)
                        d[k] += v[k] * (op.equals("div") && j == 1 ? -1 : 1);
                }
                yield d;
            }
            case "pow" -> {
                int[] d = dim(n.path("base"), units);
                for (int k = 0; k < 4; k++) d[k] *= n.path("exponent").asInt();
                yield d;
            }
            case "sqrt" -> {
                int[] d = dim(n.path("arg"), units);
                for (int k = 0; k < 4; k++) {
                    MathAst.require(d[k] % 2 == 0);
                    d[k] /= 2;
                }
                yield d;
            }
            case "sin", "cos" -> {
                var a = n.path("arg");
                same(dim(a, units), new int[4]);
                MathAst.require(
                        !a.path("op").asString().equals("symbol")
                                || Set.of("rad", "deg")
                                        .contains(units.get(a.path("name").asString())));
                yield new int[4];
            }
            default -> throw new IllegalArgumentException("Unsupported operator");
        };
    }

    private static List<JsonNode> iter(JsonNode n) {
        var r = new ArrayList<JsonNode>();
        n.forEach(r::add);
        return r;
    }
}
