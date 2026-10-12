package dev.researchhub.analysis.application;

import static org.junit.jupiter.api.Assertions.*;

import dev.researchhub.analysis.application.ProblemContracts.*;

import org.junit.jupiter.api.Test;

import tools.jackson.databind.*;
import tools.jackson.databind.json.JsonMapper;

import java.nio.file.*;
import java.util.*;

class ProblemPlanValidatorTest {
    final JsonMapper json = JsonMapper.builder().findAndAddModules().build();
    final String hash = "a".repeat(64);

    JsonNode ast(String s) {
        return json.readTree(s);
    }

    String number(int n) {
        return "{\"op\":\"number\",\"value\":\"" + n + "\"}";
    }

    String symbol(String n) {
        return "{\"op\":\"symbol\",\"name\":\"" + n + "\"}";
    }

    void check(
            String expression,
            String unit,
            List<Parameter> parameters,
            List<Unknown> unknowns,
            String kind) {
        var o = new Output("result", kind, ast(expression), unit);
        var p = new Problem("Problem", parameters, unknowns, "REAL", List.of(o), List.of(), null);
        var plan =
                new Plan(
                        "2.0",
                        "PROBLEM",
                        hash,
                        "Plan",
                        List.of(o),
                        List.of(),
                        List.of(),
                        List.of());
        ProblemPlanValidator.validate(p, plan, hash);
    }

    @Test
    void dimensionsAllOperatorsUnitsAndPolynomialDegreesAreExplicit() {
        for (String u : ProblemContracts.UNITS)
            assertEquals(4, ProblemPlanValidator.dimension(u).length);
        assertThrows(IllegalArgumentException.class, () -> ProblemPlanValidator.dimension("evil"));
        for (String op : List.of("add", "mul"))
            check(
                    "{\"op\":\"" + op + "\",\"args\":[" + number(2) + "," + number(3) + "]}",
                    "1",
                    List.of(),
                    List.of(),
                    "EVALUATE");
        for (String op : List.of("sqrt", "sin", "cos"))
            check(
                    "{\"op\":\"" + op + "\",\"arg\":" + number(4) + "}",
                    "1",
                    List.of(),
                    List.of(),
                    "EVALUATE");
        check(
                "{\"op\":\"div\",\"left\":" + symbol("d") + ",\"right\":" + symbol("t") + "}",
                "m/s",
                List.of(new Parameter("d", "1", "cm"), new Parameter("t", "2", "s")),
                List.of(),
                "EVALUATE");
        check(
                "{\"op\":\"sqrt\",\"arg\":{\"op\":\"mul\",\"args\":["
                        + symbol("d")
                        + ","
                        + symbol("d")
                        + "]}}",
                "m",
                List.of(new Parameter("d", "4", "m")),
                List.of(),
                "EVALUATE");
        for (String unit : List.of("rad", "deg"))
            check(
                    "{\"op\":\"sin\",\"arg\":" + symbol("a") + "}",
                    "1",
                    List.of(new Parameter("a", "1", unit)),
                    List.of(),
                    "EVALUATE");
        var unknown = List.of(new Unknown("x", "1"));
        for (int degree = 1; degree <= 4; degree++)
            check(
                    "{\"op\":\"eq\",\"left\":{\"op\":\"pow\",\"base\":"
                            + symbol("x")
                            + ",\"exponent\":"
                            + degree
                            + "},\"right\":"
                            + number(4)
                            + "}",
                    "1",
                    List.of(),
                    unknown,
                    "SOLVE");
        for (String op : List.of("add", "mul"))
            check(
                    "{\"op\":\"eq\",\"left\":{\"op\":\""
                            + op
                            + "\",\"args\":["
                            + symbol("x")
                            + ","
                            + number(2)
                            + "]},\"right\":"
                            + number(4)
                            + "}",
                    "1",
                    List.of(),
                    unknown,
                    "SOLVE");
        check(
                "{\"op\":\"eq\",\"left\":{\"op\":\"div\",\"left\":"
                        + symbol("x")
                        + ",\"right\":"
                        + number(2)
                        + "},\"right\":"
                        + number(4)
                        + "}",
                "1",
                List.of(),
                unknown,
                "SOLVE");
    }

    @Test
    void incompatibleSymbolsDimensionsUnknownDomainAndComplexityCannotBePlanned() {
        for (String expression :
                List.of(
                        symbol("missing"),
                        "{\"op\":\"sqrt\",\"arg\":" + symbol("d") + "}",
                        "{\"op\":\"sin\",\"arg\":" + symbol("d") + "}",
                        "{\"op\":\"add\",\"args\":[" + symbol("d") + "," + number(1) + "]}"))
            assertThrows(
                    IllegalArgumentException.class,
                    () ->
                            check(
                                    expression,
                                    "m",
                                    List.of(new Parameter("d", "1", "m")),
                                    List.of(),
                                    "EVALUATE"));
        assertThrows(
                IllegalArgumentException.class,
                () ->
                        check(
                                "{\"op\":\"sin\",\"arg\":" + symbol("a") + "}",
                                "1",
                                List.of(new Parameter("a", "1", "1")),
                                List.of(),
                                "EVALUATE"));
        var unknown = List.of(new Unknown("x", "1"));
        for (String left :
                List.of(
                        "{\"op\":\"pow\",\"base\":" + symbol("x") + ",\"exponent\":5}",
                        "{\"op\":\"pow\",\"base\":" + symbol("x") + ",\"exponent\":-1}",
                        "{\"op\":\"sin\",\"arg\":" + symbol("x") + "}",
                        "{\"op\":\"div\",\"left\":" + number(1) + ",\"right\":" + symbol("x") + "}",
                        number(1)))
            assertThrows(
                    IllegalArgumentException.class,
                    () ->
                            check(
                                    "{\"op\":\"eq\",\"left\":"
                                            + left
                                            + ",\"right\":"
                                            + number(4)
                                            + "}",
                                    "1",
                                    List.of(),
                                    unknown,
                                    "SOLVE"));
        String nested =
                "{\"op\":\"add\",\"args\":[{\"op\":\"eq\",\"left\":"
                        + number(1)
                        + ",\"right\":"
                        + number(2)
                        + "},"
                        + number(3)
                        + "]}";
        assertThrows(
                IllegalArgumentException.class,
                () -> check(nested, "1", List.of(), List.of(), "EVALUATE"));
        String huge = number(2);
        for (int i = 0; i < 5; i++) huge = "{\"op\":\"pow\",\"base\":" + huge + ",\"exponent\":8}";
        String hostile = huge;
        assertThrows(
                IllegalArgumentException.class,
                () -> check(hostile, "1", List.of(), List.of(), "EVALUATE"));
    }

    @Test
    void frozenPlansContractsAndMissingFieldsAreVersioned() throws Exception {
        var c =
                json.readValue(
                        Files.readString(
                                Path.of(
                                        "../contracts/analysis/computation-plan/v2/problem-create.json")),
                        Create.class);
        var p =
                json.readValue(
                        Files.readString(
                                Path.of(
                                        "../contracts/analysis/computation-plan/v2/problem-plan.json")),
                        Plan.class);
        ProblemPlanValidator.validate(c.problem(), p, hash);
        assertTrue(ProblemContracts.missing(c.problem()).isEmpty());
        assertThrows(
                IllegalArgumentException.class,
                () -> ProblemPlanValidator.validate(c.problem(), p, "b".repeat(64)));
        assertThrows(
                IllegalArgumentException.class,
                () ->
                        new Create(
                                "1.0", "PROBLEM", UUID.randomUUID(), "P", c.problem(), null, null));
        assertThrows(IllegalArgumentException.class, () -> new Parameter("bad", "1,2", "m"));
        assertThrows(IllegalArgumentException.class, () -> new Parameter("bad", "1", "evil"));
        assertThrows(IllegalArgumentException.class, () -> new Plot("d", "1", "0", 2, "result"));
        assertThrows(
                IllegalArgumentException.class,
                () -> new Origin(null, UUID.randomUUID(), null, null));
        var missing =
                new Problem(
                        "P",
                        List.of(new Parameter("p", null, null)),
                        List.of(new Unknown("x", null)),
                        null,
                        List.of(),
                        List.of(),
                        null);
        assertEquals(5, ProblemContracts.missing(missing).size());
        var solve =
                new Problem(
                        "P",
                        List.of(),
                        List.of(),
                        "REAL",
                        List.of(new Output("result", "SOLVE", null, null)),
                        List.of(),
                        null);
        assertEquals(3, ProblemContracts.missing(solve).size());
    }

    @org.junit.jupiter.api.Test
    void sameVersionedFixturesRetainDatasetV1AndRejectCrossWorkloads() throws Exception {
        var old =
                json.readValue(
                        Files.readString(
                                Path.of("../contracts/analysis/computation-plan/v1/plan.json")),
                        AnalysisContracts.Plan.class);
        var request =
                json.readValue(
                        Files.readString(
                                Path.of("../contracts/analysis/computation-plan/v1/request.json")),
                        AnalysisContracts.PlanningRequest.class);
        var modern =
                json.readValue(
                        Files.readString(
                                Path.of(
                                        "../contracts/analysis/computation-plan/v2/problem-plan.json")),
                        ProblemContracts.Plan.class);
        assertEquals("1.0", old.schemaVersion());
        assertFalse(request.inputs().isEmpty());
        assertEquals("2.0", modern.schemaVersion());
        assertEquals("PROBLEM", modern.workload());
        assertThrows(
                RuntimeException.class,
                () -> json.treeToValue(json.valueToTree(old), ProblemContracts.Plan.class));
        assertThrows(
                RuntimeException.class,
                () -> json.treeToValue(json.valueToTree(modern), AnalysisContracts.Plan.class));
        assertThrows(
                IllegalArgumentException.class,
                () -> new AnalysisContracts.Create("A dataset must still have input", List.of()));
    }
}
