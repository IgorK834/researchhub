package dev.researchhub.shared.math;

import tools.jackson.databind.JsonNode;

import java.util.*;

/** Shared closed AST; normalization builds notation without accepting arbitrary TeX. */
public final class MathAst {
    private MathAst() {}

    public static String notation(JsonNode ast) {
        String value = walk(ast, 0, new int[] {0});
        require(value.length() <= 4000);
        return value;
    }

    private static String walk(JsonNode n, int depth, int[] count) {
        require(n != null && n.isObject() && depth <= 12 && ++count[0] <= 128);
        String op = n.path("op").asString("");
        return switch (op) {
            case "number" -> {
                fields(n, "op", "value");
                String v = n.path("value").asString("");
                require(
                        n.path("value").isString()
                                && v.length() <= 40
                                && v.matches("-?(0|[1-9][0-9]*)(\\.[0-9]+)?")
                                && !v.equals("-0")
                                && !v.matches(".*\\.[0-9]*0"));
                yield v;
            }
            case "symbol" -> {
                fields(n, "op", "name");
                String v = n.path("name").asString("");
                require(v.matches("[A-Za-z][A-Za-z0-9]{0,15}"));
                yield "\\mathrm{" + v + "}";
            }
            case "add", "mul" -> {
                fields(n, "op", "args");
                var a = n.path("args");
                require(a.isArray() && a.size() >= 2 && a.size() <= 8);
                var parts = new ArrayList<String>();
                for (var child : a) parts.add(walk(child, depth + 1, count));
                yield "(" + String.join(op.equals("add") ? " + " : " \\cdot ", parts) + ")";
            }
            case "eq", "div" -> {
                fields(n, "op", "left", "right");
                String l = walk(n.path("left"), depth + 1, count),
                        rr = walk(n.path("right"), depth + 1, count);
                yield op.equals("eq") ? l + " = " + rr : "\\frac{" + l + "}{" + rr + "}";
            }
            case "pow" -> {
                fields(n, "op", "base", "exponent");
                require(
                        n.path("exponent").isInt()
                                && n.path("exponent").asInt() >= -8
                                && n.path("exponent").asInt() <= 8);
                yield "{"
                        + walk(n.path("base"), depth + 1, count)
                        + "}^{"
                        + n.path("exponent").asInt()
                        + "}";
            }
            case "sqrt", "sin", "cos" -> {
                fields(n, "op", "arg");
                yield "\\" + op + "{" + walk(n.path("arg"), depth + 1, count) + "}";
            }
            default -> throw new IllegalArgumentException("Unsupported math operator");
        };
    }

    public static String plain(JsonNode n) {
        notation(n);
        return readable(n);
    }

    private static String readable(JsonNode n) {
        String op = n.path("op").asString();
        return switch (op) {
            case "number" -> n.path("value").asString();
            case "symbol" -> n.path("name").asString();
            case "add", "mul" -> {
                var parts = new ArrayList<String>();
                for (var c : n.path("args")) parts.add(readable(c));
                yield "(" + String.join(op.equals("add") ? " + " : " * ", parts) + ")";
            }
            case "div", "eq" ->
                    "("
                            + readable(n.path("left"))
                            + (op.equals("div") ? " / " : " = ")
                            + readable(n.path("right"))
                            + ")";
            case "pow" -> "(" + readable(n.path("base")) + " ^ " + n.path("exponent").asInt() + ")";
            default -> op + "(" + readable(n.path("arg")) + ")";
        };
    }

    public static void value(JsonNode n) {
        fields(n, "schemaVersion", "ast", "notation", "accessibleText", "verification");
        require("1.0".equals(n.path("schemaVersion").asString()));
        var r = n.path("verification");
        if (!r.isNull()) {
            fields(r, "analysisId", "executionId", "outputName", "stepIndex", "inputHash");
            for (String id : List.of("analysisId", "executionId"))
                require(
                        r.path(id).isString()
                                && r.path(id)
                                        .asString()
                                        .matches(
                                                "(?i)[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}"));
            require(
                    r.path("outputName").isString()
                            && r.path("outputName").asString().matches("[A-Za-z][A-Za-z0-9-]{0,79}")
                            && r.path("stepIndex").isInt()
                            && r.path("stepIndex").asInt() >= 0
                            && r.path("stepIndex").asInt() <= 31
                            && r.path("inputHash").isString()
                            && r.path("inputHash").asString().matches("[a-f0-9]{64}"));
        }
        String text = notation(n.path("ast"));
        require(
                text.equals(n.path("notation").asString())
                        && plain(n.path("ast")).equals(n.path("accessibleText").asString()));
    }

    public static void fields(JsonNode n, String... fields) {
        require(n != null && n.isObject() && n.size() == fields.length);
        for (String f : fields) require(n.has(f));
    }

    public static void require(boolean valid) {
        if (!valid) throw new IllegalArgumentException("Invalid math contract");
    }
}
