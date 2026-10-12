package dev.researchhub.analysis.application;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import dev.researchhub.ai.application.*;
import dev.researchhub.ai.application.GenerationContracts.*;
import dev.researchhub.analysis.application.ProblemContracts.*;
import dev.researchhub.shared.error.*;
import dev.researchhub.workspace.application.WorkspaceAuthorizationService;

import org.junit.jupiter.api.*;

import tools.jackson.databind.*;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ObjectNode;

import java.nio.file.*;
import java.time.*;
import java.util.*;

class ProblemServiceTest {
    final JsonMapper json = JsonMapper.builder().findAndAddModules().build();
    final UUID w = UUID.randomUUID(), caller = UUID.randomUUID();
    final ProblemStore store = mock(ProblemStore.class);
    final ProblemPlanner planner = mock(ProblemPlanner.class);
    final SandboxRunner runner = mock(SandboxRunner.class);
    final WorkspaceAuthorizationService access = mock(WorkspaceAuthorizationService.class);
    final CanvasContextService contexts = mock(CanvasContextService.class);
    final ConversationStore conversations = mock(ConversationStore.class);
    final Clock clock = Clock.fixed(Instant.parse("2026-10-10T00:00:00Z"), ZoneOffset.UTC);
    ProblemService service;
    Analysis state;
    java.util.function.Consumer<ObjectNode> receiptEdit = n -> {};
    java.util.function.Consumer<ObjectNode> transportEdit = n -> {};
    java.util.function.Consumer<ObjectNode> calculationEdit = n -> {};

    @BeforeEach
    void setup() throws Exception {
        service =
                new ProblemService(
                        store, planner, runner, access, contexts, conversations, clock, json);
        when(store.create(any(), any(), anyString()))
                .thenAnswer(
                        i -> {
                            state = i.getArgument(0);
                            return state;
                        });
        when(store.find(any(), any())).thenAnswer(i -> Optional.ofNullable(state));
        when(store.beginPlan(any(), any())).thenReturn(true);
        doAnswer(
                        i -> {
                            state = i.getArgument(0);
                            return null;
                        })
                .when(store)
                .planned(any());
        when(store.enqueue(any(), any(), any(), any())).thenAnswer(i -> i.getArgument(2));
        when(planner.planProblem(any()))
                .thenAnswer(
                        i -> {
                            PlanningRequest req = i.getArgument(0);
                            if (req == null) return null;
                            var p =
                                    new Plan(
                                            "2.0",
                                            "PROBLEM",
                                            req.problemHash(),
                                            "Compute frozen formula",
                                            req.problem().expectedOutputs(),
                                            req.problem().assumptions(),
                                            List.of(),
                                            List.of());
                            return new AnalysisContracts.Candidate(
                                    "1.0",
                                    req.request().requestId(),
                                    new ModelMetadata("deterministic", "fixture", "1", true, false),
                                    new Usage(1, 1, 2, true),
                                    "fixture",
                                    json.writeValueAsString(p));
                        });
        when(runner.run(any()))
                .thenAnswer(
                        i -> {
                            SandboxRunner.Request req = i.getArgument(0);
                            if (req == null) return null;
                            ObjectNode text;
                            if (req.problem().verification()) {
                                text =
                                        json.createObjectNode()
                                                .put("schemaVersion", "2.0")
                                                .put("phase", "VERIFY")
                                                .put("status", "CHECKED")
                                                .put("inputHash", state.snapshot().inputHash())
                                                .put(
                                                        "problemSha256",
                                                        RetrievalIdentity.hash(
                                                                req.problem().snapshot()))
                                                .put(
                                                        "planSha256",
                                                        RetrievalIdentity.hash(
                                                                req.problem().plan()))
                                                .put(
                                                        "candidateSha256",
                                                        RetrievalIdentity.hash(
                                                                req.problem().candidate()))
                                                .put(
                                                        "checkedOutputs",
                                                        state.plan().outputs().size())
                                                .put(
                                                        "checkedPoints",
                                                        state.snapshot().problem().plot() == null
                                                                ? 0
                                                                : state.snapshot()
                                                                        .problem()
                                                                        .plot()
                                                                        .points());
                                text.set(
                                        "tolerance",
                                        json.readTree("{\"absolute\":1e-10,\"relative\":1e-10}"));
                                receiptEdit.accept(text);
                            } else {
                                text =
                                        json.createObjectNode()
                                                .put("schemaVersion", "2.0")
                                                .put("workload", "PROBLEM")
                                                .put("inputHash", state.snapshot().inputHash())
                                                .putNull("plot");
                                var values = json.createArrayNode();
                                for (var o : state.plan().outputs()) {
                                    var output =
                                            json.createObjectNode()
                                                    .put("name", o.name())
                                                    .put("kind", o.kind())
                                                    .put("unit", o.unit());
                                    output.set("expression", o.expression());
                                    output.set("values", json.readTree("[0.5]"));
                                    var step=json.createObjectNode().put("operation",o.kind()).put("unit",o.unit());
                                    step.set("expression",o.expression());step.set("values",output.path("values"));
                                    var substitution=step.putObject("substitution");
                                    for(var parameter:state.snapshot().problem().parameters())substitution.putObject(parameter.symbol()).put("value",parameter.value()).put("unit",parameter.unit()).put("siValue",parameter.symbol().equals("distance")?"1":"2");
                                    output.set("steps",json.createArrayNode().add(step));
                                    values.add(output);
                                }
                                text.set("outputs", values);
                                if (state.snapshot().problem().plot() != null) {
                                    var series =
                                            json.createObjectNode()
                                                    .put("parameter", "distance")
                                                    .put("output", "result")
                                                    .put("xUnit", "cm")
                                                    .put("yUnit", "m/s");
                                    var points = json.createArrayNode();
                                    for (int x = 0; x <= 100; x += 10)
                                        points.add(
                                                json.createArrayNode()
                                                        .add((double) x)
                                                        .add(x / 200.0));
                                    series.set("points", points);
                                    text.set("plot", series);
                                }
                                calculationEdit.accept(text);
                            }
                            var outputs = json.createArrayNode();
                            for (var o : req.outputs()) {
                                if (o.kind() == AnalysisContracts.OutputKind.TEXT)
                                    outputs.add(
                                            json.createObjectNode()
                                                    .put("name", o.name())
                                                    .put("kind", "TEXT")
                                                    .put("text", text.toString()));
                                else if (o.kind() == AnalysisContracts.OutputKind.TABLE)
                                    outputs.add(
                                            json.readTree(
                                                    "{\"name\":\"plot-data\",\"kind\":\"TABLE\",\"columns\":[\"x\",\"y\"],\"rows\":[[0,0],[1,0.5]]}"));
                                else
                                    outputs.add(
                                            json.readTree(
                                                    "{\"name\":\"plot\",\"kind\":\"CHART\",\"file\":\"plot.png\",\"title\":\"Result\",\"xAxis\":{\"label\":\"x\",\"unit\":\"cm\",\"scale\":\"LINEAR\"},\"yAxis\":{\"label\":\"y\",\"unit\":\"m/s\",\"scale\":\"LINEAR\"},\"series\":[]}"));
                            }
                            var files = new LinkedHashMap<String, byte[]>();
                            var result = json.createObjectNode().put("schemaVersion", "2.0");
                            result.set("outputs", outputs);
                            for (var output : outputs) {
                                if (output.path("name").asString().equals("plot-data"))
                                    ((ObjectNode) output)
                                            .set("rows", text.path("plot").path("points"));
                                if (output.path("name").asString().equals("plot"))
                                    ((ObjectNode) output)
                                            .set(
                                                    "series",
                                                    json.readTree(
                                                            "[{\"name\":\"result\",\"tableName\":\"plot-data\",\"xColumn\":\"x\",\"yColumn\":\"y\",\"yTransform\":\"IDENTITY\"}]"));
                            }
                            transportEdit.accept(result);
                            files.put("result.json", json.writeValueAsBytes(result));
                            if (req.outputs().size() > 1)
                                files.put(
                                        "plot.png",
                                        new byte[] {(byte) 137, 80, 78, 71, 13, 10, 26, 10});
                            return new SandboxRunner.Result(
                                    true,
                                    null,
                                    0,
                                    false,
                                    "",
                                    "",
                                    false,
                                    false,
                                    "sha256:" + "c".repeat(64),
                                    "1.2.0",
                                    files,Map.of("problem.py","a".repeat(64),"verify_problem.py","b".repeat(64)));
                        });
    }

    Create command() throws Exception {
        return json.readValue(
                Files.readString(
                        Path.of("../contracts/analysis/computation-plan/v2/problem-create.json")),
                Create.class);
    }

    Analysis ready(boolean plot) throws Exception {
        var c = command();
        var p = c.problem();
        if (!plot)
            p =
                    new Problem(
                            p.statement(),
                            p.parameters(),
                            p.unknowns(),
                            p.domain(),
                            p.expectedOutputs(),
                            p.assumptions(),
                            null);
        service.create(
                w,
                caller,
                new Create("2.0", "PROBLEM", UUID.randomUUID(), c.userPrompt(), p, null, null));
        return service.plan(w, caller, state.id());
    }

    Execution execute() {
        var e = service.enqueue(w, caller, state.id());
        service.execute(new ProblemStore.Job(w, caller, e, null));
        var cap = org.mockito.ArgumentCaptor.forClass(Execution.class);
        verify(store).complete(eq(w), cap.capture(), any());
        return cap.getValue();
    }

    @Test
    void planAndFreshVerificationWithAndWithoutPlotAreBoundToCanonicalInputs() throws Exception {
        ready(false);
        var e = execute();
        assertEquals("SUCCEEDED", e.status());
        assertEquals("CHECKED", e.verification().status());
        assertEquals("1.2.0", e.verification().runtimeVersion());
        verify(runner, times(2)).run(any());
        assertEquals(state.snapshot().inputHash(), e.inputHash());
        reset(store);
    }

    @Test
    void plotRunAndSavedReproductionDoNotCallModelAgain() throws Exception {
        ready(true);
        var e = execute();
        when(store.execution(w, state.id(), e.id())).thenReturn(Optional.of(e));
        when(store.enqueue(any(), any(), any(), any())).thenAnswer(i -> i.getArgument(2));
        var next = service.reproduce(w, caller, state.id(), e.id());
        assertEquals(e.planHash(), next.planHash());
        verify(planner, times(1)).planProblem(any());
        verify(store)
                .enqueue(
                        eq(w),
                        eq(caller),
                        any(),
                        eq(
                                new ReproductionContracts.RuntimeIdentity(
                                        e.imageId(), e.runtimeVersion())));
        when(store.artifact(w, state.id(), e.id(), "plot.png")).thenReturn(new byte[] {1});
        assertArrayEquals(
                new byte[] {1}, service.artifact(w, caller, state.id(), e.id(), "plot.png"));
        assertThrows(
                ResourceNotFoundException.class,
                () -> service.artifact(w, caller, state.id(), UUID.randomUUID(), "plot.png"));
    }

    @Test
    void missingInputsNeverInvokePlannerOrRunner() throws Exception {
        var c = command();
        var p = c.problem();
        var incomplete =
                new Problem(
                        p.statement(),
                        List.of(new Parameter("distance", null, null)),
                        List.of(new Unknown("x", null)),
                        null,
                        List.of(new Output("result", "SOLVE", null, null)),
                        List.of(),
                        null);
        var a =
                service.create(
                        w,
                        caller,
                        new Create(
                                "2.0",
                                "PROBLEM",
                                UUID.randomUUID(),
                                "Incomplete",
                                incomplete,
                                null,
                                null));
        assertEquals("WAITING_FOR_INPUT", a.status());
        assertEquals(a, service.plan(w, caller, a.id()));
        assertThrows(ConflictException.class, () -> service.enqueue(w, caller, a.id()));
        verifyNoInteractions(planner, runner);
    }

    @Test
    void invalidModelFailureClarificationAndDuplicateReservationAreSafe() throws Exception {
        var c = command();
        service.create(w, caller, c);
        when(store.beginPlan(w, state.id())).thenReturn(false);
        assertThrows(ConflictException.class, () -> service.plan(w, caller, state.id()));
        when(store.beginPlan(w, state.id())).thenReturn(true);
        when(planner.planProblem(any())).thenThrow(new ModelFailure(ApiErrorCode.AI_UNAVAILABLE));
        assertEquals("FAILED", service.plan(w, caller, state.id()).status());
    }

    @Test
    void modelCannotChangeFormulaOrFrozenHash() throws Exception {
        var c = command();
        service.create(w, caller, c);
        when(planner.planProblem(any()))
                .thenAnswer(
                        i -> {
                            PlanningRequest req = i.getArgument(0);
                            return new AnalysisContracts.Candidate(
                                    "1.0",
                                    UUID.randomUUID(),
                                    new ModelMetadata("deterministic", "test", "1", true, false),
                                    new Usage(1, 1, 2, true),
                                    "id",
                                    "{}");
                        });
        assertEquals("FAILED", service.plan(w, caller, state.id()).status());
    }

    @Test
    void modelClarificationIsPersistedAndReadyPlanIsIdempotent() throws Exception {
        ready(false);
        assertEquals(state, service.plan(w, caller, state.id()));
        var c = command();
        service.create(w, caller, c);
        when(planner.planProblem(any()))
                .thenAnswer(
                        i -> {
                            PlanningRequest req = i.getArgument(0);
                            var p =
                                    new Plan(
                                            "2.0",
                                            "PROBLEM",
                                            req.problemHash(),
                                            "Clarify",
                                            List.of(),
                                            List.of(),
                                            List.of(),
                                            List.of("Check the assumptions."));
                            return new AnalysisContracts.Candidate(
                                    "1.0",
                                    req.request().requestId(),
                                    new ModelMetadata("deterministic", "test", "1", true, false),
                                    new Usage(1, 1, 2, true),
                                    "id",
                                    json.writeValueAsString(p));
                        });
        assertEquals("WAITING_FOR_INPUT", service.plan(w, caller, state.id()).status());
    }

    @Test
    void forgedVerificationReceiptNeverPublishes() throws Exception {
        for (String field :
                List.of(
                        "schemaVersion",
                        "phase",
                        "status",
                        "inputHash",
                        "problemSha256",
                        "planSha256",
                        "candidateSha256")) {
            receiptEdit = n -> n.put(field, "forged");
            ready(false);
            var e = execute();
            assertEquals("FAILED", e.status());
            assertNull(e.result());
            assertEquals("INVALID", e.verification().status());
            assertEquals("SUCCEEDED", e.computationStatus());
            clearInvocations(store, runner);
        }
        for (String field : List.of("checkedOutputs", "checkedPoints")) {
            receiptEdit = n -> n.put(field, 100);
            ready(false);
            assertEquals("FAILED", execute().status());
            clearInvocations(store, runner);
        }
        receiptEdit = n -> ((ObjectNode) n.path("tolerance")).put("absolute", 0.1);
        ready(false);
        assertEquals("FAILED", execute().status());
    }

    @Test
    void invalidCalculationAndRunnerFailuresRemainBounded() throws Exception {
        for (String field : List.of("schemaVersion", "workload", "inputHash")) {
            calculationEdit = n -> n.put(field, "bad");
            ready(false);
            assertEquals("FAILED", execute().status());
            clearInvocations(store, runner);
        }
        calculationEdit = n -> n.set("outputs", json.createArrayNode());
        ready(false);
        assertEquals("FAILED", execute().status());
        clearInvocations(store, runner);
        calculationEdit = n -> {};
        ready(false);
        when(runner.run(any()))
                .thenReturn(
                        new SandboxRunner.Result(
                                false,
                                "EXECUTION_TIMEOUT",
                                null,
                                true,
                                "",
                                "",
                                false,
                                false,
                                null,
                                null,
                                Map.of()));
        assertEquals("EXECUTION_TIMEOUT", execute().failureCode());
    }

    @Test
    void verifierFailureAndPermissionRevocationPublishNoResult() throws Exception {
        ready(false);
        var original =
                runner.run(
                        new SandboxRunner.Request(
                                UUID.randomUUID(),
                                state.id(),
                                "# controlled",
                                List.of(),
                                List.of(
                                        new SandboxRunner.Output(
                                                "calculation", AnalysisContracts.OutputKind.TEXT)),
                                null,
                                new SandboxRunner.ProblemInput(
                                        ProblemJson.canonical(json, state.snapshot()),
                                        ProblemJson.canonical(json, state.plan()),
                                        null)));
        when(runner.run(any()))
                .thenReturn(
                        original,
                        new SandboxRunner.Result(
                                false,
                                "EXECUTION_TIMEOUT",
                                null,
                                true,
                                "",
                                "",
                                false,
                                false,
                                original.imageId(),
                                original.runtimeVersion(),
                                Map.of()));
        assertEquals("VERIFICATION_FAILED", execute().failureCode());
        clearInvocations(store, runner);
        doThrow(new ForbiddenException("Denied")).when(access).requireContentEditor(w, caller);
        var e =
                new Execution(
                        UUID.randomUUID(),
                        state.id(),
                        "QUEUED",
                        null,
                        clock.instant(),
                        null,
                        null,
                        null,
                        state.snapshot().inputHash(),
                        ProblemJson.hash(json, state.plan()),
                        null,
                        null);
        service.execute(new ProblemStore.Job(w, caller, e, null));
        var cap = org.mockito.ArgumentCaptor.forClass(Execution.class);
        verify(store).complete(eq(w), cap.capture(), any());
        assertEquals("EXECUTION_FORBIDDEN", cap.getValue().failureCode());
    }

    @Test
    void missingExecutionAndRuntimeCannotBeReproduced() throws Exception {
        ready(false);
        when(store.executions(w, state.id())).thenReturn(List.of());
        assertThrows(
                ResourceNotFoundException.class,
                () -> service.reproduce(w, caller, state.id(), UUID.randomUUID()));
        var old =
                new Execution(
                        UUID.randomUUID(),
                        state.id(),
                        "FAILED",
                        "SANDBOX_DISABLED",
                        clock.instant(),
                        clock.instant(),
                        null,
                        null,
                        state.snapshot().inputHash(),
                        "a".repeat(64),
                        null,
                        null);
        when(store.execution(w, state.id(), old.id())).thenReturn(Optional.of(old));
        assertThrows(
                ConflictException.class, () -> service.reproduce(w, caller, state.id(), old.id()));
        when(store.claim()).thenReturn(Optional.empty());
        service.dispatch();
        assertTrue(service.isProblem(w, state.id()));
        state = null;
        assertFalse(service.isProblem(w, UUID.randomUUID()));
        assertThrows(
                ResourceNotFoundException.class, () -> service.find(w, caller, UUID.randomUUID()));
    }

    @Test
    void enabledDispatcherClaimsAndDisabledDispatcherStaysQuiet() {
        var target = mock(ProblemService.class);
        new ProblemExecutionDispatcher(target, false).dispatch();
        verifyNoInteractions(target);
        new ProblemExecutionDispatcher(target, true).dispatch();
        verify(target).dispatch();
    }

    @Test
    void forgedCalculationMetadataAndPlotTransportCannotPublish() throws Exception {
        for (String field : List.of("name", "kind", "unit", "expression")) {
            calculationEdit = n -> ((ObjectNode) n.path("outputs").get(0)).put(field, "forged");
            ready(false);
            assertEquals("FAILED", execute().status());
            clearInvocations(store, runner);
        }
        for (var values :
                List.of(
                        json.createArrayNode(),
                        json.readTree("[1,2,3,4,5]"),
                        json.readTree("[\"NaN\"]"))) {
            calculationEdit = n -> ((ObjectNode) n.path("outputs").get(0)).set("values", values);
            ready(false);
            assertEquals("FAILED", execute().status());
            clearInvocations(store, runner);
        }
        calculationEdit = n -> n.set("plot", json.createObjectNode());
        ready(false);
        assertEquals("FAILED", execute().status());
        clearInvocations(store, runner);
        for (String field : List.of("parameter", "output", "xUnit", "yUnit")) {
            calculationEdit = n -> ((ObjectNode) n.path("plot")).put(field, "forged");
            ready(true);
            assertEquals("FAILED", execute().status());
            clearInvocations(store, runner);
        }
        calculationEdit = n -> ((ObjectNode) n.path("plot")).set("points", json.createArrayNode());
        ready(true);
        assertEquals("FAILED", execute().status());
        clearInvocations(store, runner);
        calculationEdit = n -> {};
        transportEdit =
                n ->
                        ((ObjectNode) n.path("outputs").get(1))
                                .set("rows", json.readTree("[[0,5000]]"));
        ready(true);
        assertEquals("FAILED", execute().status());
        clearInvocations(store, runner);
        transportEdit =
                n -> ((ObjectNode) n.path("outputs").get(2).path("xAxis")).put("unit", "kg");
        ready(true);
        assertEquals("FAILED", execute().status());
        clearInvocations(store, runner);
        transportEdit =
                n ->
                        ((ObjectNode) n.path("outputs").get(2).path("series").get(0))
                                .put("yTransform", "INVERSE");
        ready(true);
        assertEquals("FAILED", execute().status());
    }

    @Test
    void permissionRevokedBeforePublicationRetainsArithmeticOutcomeButNoResult() throws Exception {
        ready(false);
        clearInvocations(access);
        var calls = new java.util.concurrent.atomic.AtomicInteger();
        doAnswer(
                        i -> {
                            if (calls.incrementAndGet() == 3)
                                throw new ForbiddenException("Revoked before publication");
                            return null;
                        })
                .when(access)
                .requireContentEditor(w, caller);
        var e = execute();
        assertEquals("FAILED", e.status());
        assertEquals("EXECUTION_FORBIDDEN", e.failureCode());
        assertEquals("SUCCEEDED", e.computationStatus());
        assertEquals("CHECKED", e.verification().status());
        assertNull(e.result());
        verify(store).complete(eq(w), any(), eq(Map.of()));
    }

    @Test
    void omittedParameterDeclarationsAskForInputInsteadOfCalculating() throws Exception {
        var c = command();
        var p = c.problem();
        var incomplete =
                new Problem(
                        p.statement(),
                        List.of(),
                        List.of(),
                        "REAL",
                        List.of(
                                new Output(
                                        "result",
                                        "EVALUATE",
                                        json.readTree(
                                                "{\"op\":\"mul\",\"args\":[{\"op\":\"symbol\",\"name\":\"distance\"},{\"op\":\"symbol\",\"name\":\"time\"}]}"),
                                        "m")),
                        p.assumptions(),
                        null);
        var saved =
                service.create(
                        w,
                        caller,
                        new Create(
                                "2.0",
                                "PROBLEM",
                                UUID.randomUUID(),
                                c.userPrompt(),
                                incomplete,
                                null,
                                null));
        assertEquals("WAITING_FOR_INPUT", saved.status());
        assertEquals(2, saved.missing().size());
        assertThrows(ConflictException.class, () -> service.enqueue(w, caller, saved.id()));
        verifyNoInteractions(planner, runner);
    }
}
