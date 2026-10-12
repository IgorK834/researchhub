package dev.researchhub.ai.api;

import static org.junit.jupiter.api.Assertions.*;

import dev.researchhub.ai.application.*;
import dev.researchhub.ai.application.CanvasContracts.*;
import dev.researchhub.ai.application.CanvasConversationContracts.*;
import dev.researchhub.ai.application.CanvasProposalContracts.*;
import dev.researchhub.document.application.*;
import dev.researchhub.document.application.CanvasTargets.*;
import dev.researchhub.shared.infrastructure.persistence.PostgresTestcontainersConfiguration;
import dev.researchhub.support.ApiBrowser;

import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.*;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.*;

import tools.jackson.databind.*;

import java.net.*;
import java.net.http.*;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.*;

/**
 * Product HTTP -> durable turn -> real Python model worker -> conditional legacy/canonical Yjs
 * write.
 */
@SpringBootTest(
        webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = {
            "researchhub.processing.dispatcher.enabled=false",
                    "researchhub.ai.canvas.dispatcher.enabled=false",
            "researchhub.analysis.execution.dispatcher.enabled=false",
            "researchhub.analysis.sandbox.enabled=true",
                    "researchhub.collaboration.enabled=true",
            "researchhub.collaboration.service-token=canvas-proposal-test-token-at-least-32-bytes"
        })
@ActiveProfiles("local")
@Import(PostgresTestcontainersConfiguration.class)
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class CanvasProposalApiIntegrationTest {
    static final int WORKER = CanvasApiIntegrationTest.freePort(),
            SIDECAR = CanvasApiIntegrationTest.freePort(),
            BROWSER = CanvasApiIntegrationTest.freePort();
    static final String TOKEN = "canvas-proposal-test-token-at-least-32-bytes",
            BLOCK = "00000001-0000-4000-8000-000000000001";

    @DynamicPropertySource
    static void config(DynamicPropertyRegistry p) {
        p.add("researchhub.processing.worker.base-url", () -> "http://127.0.0.1:" + WORKER);
        p.add("researchhub.processing.worker.service-token", () -> TOKEN);
        p.add("researchhub.collaboration.internal-url", () -> "http://127.0.0.1:" + SIDECAR);
        p.add(
                "researchhub.collaboration.websocket-url",
                () -> "ws://localhost:" + BROWSER + "/collaboration");
    }

    @Value("${local.server.port}")
    int port;

    @Autowired ObjectMapper json;
    @Autowired JdbcTemplate jdbc;
    @Autowired CanvasTurnDispatcher dispatcher;
    @Autowired dev.researchhub.export.application.ExportDispatcher exportDispatcher;

    @org.springframework.test.context.bean.override.mockito.MockitoSpyBean
    dev.researchhub.ai.infrastructure.HttpModelProvider models;

    @org.springframework.test.context.bean.override.mockito.MockitoSpyBean
    dev.researchhub.security.application.CostQuotaStore quotas;
    @Autowired dev.researchhub.analysis.application.ProblemService problems;
    @Autowired CanvasTurnStore turns;
    @Autowired CanvasConversationService service;
    @Autowired CanvasOperationService operations;
    Process worker, sidecar;
    ApiBrowser owner, viewer, outsider;
    UUID workspace, document, caller;
    String route, conversations, viewerId;

    @BeforeAll
    void start() throws Exception {
        var w =
                new ProcessBuilder(".venv/bin/python", "-m", "researchhub_worker")
                        .directory(Path.of("../ai-worker").toFile())
                        .redirectErrorStream(true)
                        .redirectOutput(Path.of("target/canvas-proposals-worker.log").toFile());
        w.environment()
                .putAll(
                        Map.of(
                                "AI_WORKER_HOST",
                                "127.0.0.1",
                                "AI_WORKER_PORT",
                                String.valueOf(WORKER),
                                "AI_WORKER_SERVICE_TOKEN",
                                TOKEN,
                                "AI_WORKER_MODEL_PROVIDER",
                                "deterministic"));
        worker = w.start();
        var s =
                new ProcessBuilder("node", "dist/main.js")
                        .directory(Path.of("../collaboration").toFile())
                        .redirectErrorStream(true)
                        .redirectOutput(Path.of("target/canvas-proposals-sidecar.log").toFile());
        s.environment()
                .putAll(
                        Map.of(
                                "COLLABORATION_PORT",
                                String.valueOf(SIDECAR),
                                "COLLABORATION_SERVICE_TOKEN",
                                TOKEN,
                                "COLLABORATION_BACKEND_URL",
                                "http://localhost:" + port,
                                "COLLABORATION_ALLOWED_ORIGINS",
                                "http://localhost:" + BROWSER));
        sidecar = s.start();
        CanvasApiIntegrationTest.awaitReady(WORKER);
        CanvasApiIntegrationTest.awaitReady(SIDECAR);
    }

    @AfterAll
    void stop() throws Exception {
        CanvasApiIntegrationTest.stop(sidecar);
        CanvasApiIntegrationTest.stop(worker);
    }

    @BeforeEach
    void setup() throws Exception {
        jdbc.execute("TRUNCATE users,workspaces CASCADE");
        owner = new ApiBrowser(port, json);
        viewer = new ApiBrowser(port, json);
        outsider = new ApiBrowser(port, json);
        caller = UUID.fromString(owner.signUp("proposal-owner@canvas.test", "Owner"));
        viewerId = viewer.signUp("proposal-viewer@canvas.test", "Viewer");
        outsider.signUp("proposal-outsider@canvas.test", "Outsider");
        workspace = UUID.fromString(owner.createdWorkspaceId("Canvas proposals", "E2E"));
        assertEquals(
                201,
                owner.postJson(
                                "/api/workspaces/" + workspace + "/members",
                                "{\"email\":\"proposal-viewer@canvas.test\",\"role\":\"VIEWER\"}")
                        .statusCode());
        var created =
                owner.postJson(
                        "/api/workspaces/" + workspace + "/documents",
                        """
                        {"title":"Canvas","content":{"type":"doc","content":[{"type":"paragraph","attrs":{"blockId":"%s"},"content":[{"type":"text","text":"prefix TARGET suffix","marks":[{"type":"bold"}]}]},{"type":"paragraph","content":[{"type":"text","text":"OUTSIDE"}]}]}}
                        """
                                .formatted(BLOCK));
        assertEquals(201, created.statusCode(), created.body());
        document = UUID.fromString(owner.json(created).path("id").asString());
        route = "/api/workspaces/" + workspace + "/documents/" + document;
        conversations = "/api/workspaces/" + workspace + "/ai/conversations";
    }

    JsonNode doc() throws Exception {
        return owner.json(owner.get(route));
    }

    UUID context(boolean caret) throws Exception {
        var current = doc();
        int from = 7, to = caret ? 7 : 13;
        var target =
                new Target(
                        caret ? Kind.CARET : Kind.TEXT,
                        new Endpoint(BLOCK, List.of(0), from),
                        new Endpoint(BLOCK, List.of(0), to),
                        CanvasDocumentTarget.hash(caret ? "prefix \0TARGET suffix" : "TARGET"));
        var capture =
                new Capture(
                        "1.0",
                        UUID.randomUUID(),
                        current.path("revision").asLong(),
                        null,
                        null,
                        null,
                        null,
                        target);
        var result = owner.postJson(route + "/ai/contexts", json.writeValueAsString(capture));
        assertEquals(200, result.statusCode(), result.body());
        return UUID.fromString(owner.json(result).path("contextId").asString());
    }

    TurnState reserve(UUID context, Intent intent, String instruction, UUID reference)
            throws Exception {
        var turn =
                new Turn(
                        "1.0",
                        UUID.randomUUID(),
                        context,
                        intent,
                        instruction,
                        null,
                        reference,
                        new Scope(List.of(), List.of()));
        var result =
                owner.postJson(
                        conversations + "/contextual",
                        json.writeValueAsString(
                                new FirstTurn("1.0", UUID.randomUUID(), context, turn)));
        assertEquals(202, result.statusCode(), result.body());
        return json.readValue(result.body(), TurnState.class);
    }

    Proposal propose(boolean caret, String instruction) throws Exception {
        var state = reserve(context(caret), Intent.EDIT, instruction, null);
        dispatcher.dispatchAvailable();
        var ready = turns.find(workspace, state.conversationId(), state.turnId());
        assertEquals("PROPOSAL_READY", ready.status(), ready.toString());
        var result = owner.get(route + "/ai/proposals/" + ready.proposalId());
        assertEquals(200, result.statusCode(), result.body());
        return json.readValue(result.body(), Proposal.class);
    }

    String acceptBody(Proposal p, UUID id) {
        return json.writeValueAsString(new Accept(id, p.versionHash()));
    }

    HttpResponse<String> accept(Proposal p, UUID id) throws Exception {
        return owner.postJson(route + "/ai/proposals/" + p.id() + "/accept", acceptBody(p, id));
    }

    @Test
    void legacyCaretPreviewRejectAndReplacementPreserveOutsideContent() throws Exception {
        var before = doc().path("content");
        var p = propose(true, "Dodaj treść");
        assertEquals(Mode.INSERT_AT_ANCHOR, p.mode());
        assertEquals(before, doc().path("content"));
        assertTrue(p.warnings().stream().anyMatch(w -> w.contains("No source evidence")));
        assertEquals(
                200,
                owner.postJson(route + "/ai/proposals/" + p.id() + "/reject", "{}").statusCode());
        assertEquals(before, doc().path("content"));
        assertEquals(409, accept(p, UUID.randomUUID()).statusCode());
        p = propose(false, "Popraw tekst");
        var accepted = accept(p, UUID.randomUUID());
        assertEquals(200, accepted.statusCode(), accepted.body());
        var body = doc().path("content").path("content");
        assertEquals(4, body.size());
        assertEquals("prefix ", body.path(0).at("/content/0/text").asString());
        assertEquals("TARGET", body.path(1).at("/content/0/text").asString());
        assertEquals(" suffix", body.path(2).at("/content/0/text").asString());
        assertEquals("OUTSIDE", body.path(3).at("/content/0/text").asString());
        assertEquals("bold", body.path(2).at("/content/0/marks/0/type").asString());
        assertEquals(
                1,
                jdbc.queryForObject(
                        "SELECT count(*) FROM document_content_operations WHERE"
                                + " operation_type='AI_ACCEPTED'",
                        Integer.class));
    }

    @Test
    void concurrentAcceptanceReplayAndChangedIdentityAreAtomic() throws Exception {
        var p = propose(true, "Dodaj treść");
        UUID id = UUID.randomUUID();
        String body = acceptBody(p, id);
        String path = route + "/ai/proposals/" + p.id() + "/accept";
        assertEquals(403, owner.sendWithoutCsrf("POST", path, body).statusCode());
        try (var pool = Executors.newVirtualThreadPerTaskExecutor()) {
            var a = pool.submit(() -> owner.postJson(path, body));
            var b = pool.submit(() -> owner.postJson(path, body));
            var one = a.get();
            var two = b.get();
            assertEquals(200, one.statusCode(), one.body());
            assertEquals(owner.json(one), owner.json(two));
        }
        assertEquals(200, accept(p, id).statusCode());
        assertEquals(
                1,
                jdbc.queryForObject(
                        "SELECT count(*) FROM canvas_operations WHERE receipt IS NOT NULL",
                        Integer.class));
        assertEquals(
                409,
                owner.postJson(path, json.writeValueAsString(new Accept(id, "a".repeat(64))))
                        .statusCode());
        assertEquals(409, accept(p, UUID.randomUUID()).statusCode());
        assertEquals(403, viewer.postJson(path, body).statusCode());
        assertEquals(404, outsider.get(route + "/ai/proposals/" + p.id()).statusCode());
    }

    @Test
    void targetConflictsPreservePendingProposalAndUnrelatedEditsSurvive() throws Exception {
        var p = propose(false, "Popraw tekst");
        jdbc.update(
                "UPDATE documents SET"
                    + " content=jsonb_set(content,'{content,1,content,0,text}','\"COLLABORATOR\"'),revision=revision+1"
                    + " WHERE id=?",
                document);
        var result = accept(p, UUID.randomUUID());
        assertEquals(200, result.statusCode(), result.body());
        assertTrue(doc().toString().contains("COLLABORATOR"));
    }

    @Test
    void changedTargetAndRevokedPermissionDoNotPublishFalseProvenance() throws Exception {
        var p = propose(false, "Popraw tekst");
        jdbc.update(
                "UPDATE documents SET"
                        + " content=jsonb_set(content,'{content,0,content,0,text}','\"changed"
                        + " target\"'),revision=revision+1 WHERE id=?",
                document);
        assertEquals(409, accept(p, UUID.randomUUID()).statusCode());
        assertEquals(
                "PENDING",
                owner.json(owner.get(route + "/ai/proposals/" + p.id())).path("state").asString());
        assertEquals(
                0,
                jdbc.queryForObject(
                        "SELECT count(*) FROM canvas_operations WHERE receipt IS NOT NULL",
                        Integer.class));
        assertEquals(
                200,
                owner.postJson("/api/workspaces/" + workspace + "/archive", "{}").statusCode());
        assertEquals(409, accept(p, UUID.randomUUID()).statusCode());
    }

    @Test
    void conditionalUndoReplaysAndKeepsOutsideEdits() throws Exception {
        var original = doc().path("content");
        var p = propose(true, "Dodaj treść");
        var result = owner.json(accept(p, UUID.randomUUID()));
        UUID undo = UUID.randomUUID();
        String path = route + "/ai/operations/" + result.path("operationId").asString() + "/undo",
                body = json.writeValueAsString(new Undo(undo));
        jdbc.update(
                "UPDATE documents SET"
                    + " content=jsonb_set(content,'{content,3,content,0,text}','\"COLLABORATOR\"'),revision=revision+1"
                    + " WHERE id=?",
                document);
        var undone = owner.postJson(path, body);
        assertEquals(200, undone.statusCode(), undone.body());
        assertEquals(owner.json(undone), owner.json(owner.postJson(path, body)));
        assertEquals(
                original.path("content").path(0), doc().path("content").path("content").path(0));
        assertTrue(doc().toString().contains("COLLABORATOR"));
    }

    @Test
    void undoDoesNotEraseSubsequentHumanEdits() throws Exception {
        var p = propose(true, "Dodaj treść");
        var result = owner.json(accept(p, UUID.randomUUID()));
        jdbc.update(
                "UPDATE documents SET"
                        + " content=jsonb_set(content,'{content,1,content,0,text}','\"HUMAN"
                        + " CHANGE\"'),revision=revision+1 WHERE id=?",
                document);
        var before = doc().path("content");
        assertEquals(
                409,
                owner.postJson(
                                route
                                        + "/ai/operations/"
                                        + result.path("operationId").asString()
                                        + "/undo",
                                json.writeValueAsString(new Undo(UUID.randomUUID())))
                        .statusCode());
        assertEquals(before, doc().path("content"));
    }

    @Test
    void durableStagesFenceLateResponsesWithoutRepeatingPaidInference() throws Exception {
        var state = reserve(context(true), Intent.EDIT, "Dodaj treść", null);
        var work = turns.claim().orElseThrow();
        assertTrue(turns.beginModel(work));
        assertFalse(turns.beginModel(work));
        jdbc.update(
                "UPDATE canvas_turns SET started_at=now()-interval '6 minutes' WHERE id=?",
                state.turnId());
        assertTrue(turns.claim().isEmpty());
        assertEquals(
                "FAILED", turns.find(workspace, state.conversationId(), state.turnId()).status());
        service.execute(work);
        assertEquals(
                0, jdbc.queryForObject("SELECT count(*) FROM canvas_proposals", Integer.class));
    }

    @Test
    void typedAnalysisAndProblemRoutesAndInventedReferencesNeverRunTheSandbox() throws Exception {
        for (var intent : List.of(Intent.ANALYZE, Intent.SOLVE)) {
            var state = reserve(context(false), intent, "Oblicz zadanie", null);
            dispatcher.dispatchAvailable();
            assertEquals(
                    "WAITING_FOR_INPUT",
                    turns.find(workspace, state.conversationId(), state.turnId()).status());
        }
        assertEquals(1,jdbc.queryForObject("SELECT count(*) FROM analysis_problems",Integer.class));
        var frozen=json.readTree(jdbc.queryForObject("SELECT payload::text FROM analysis_problems",String.class));assertEquals("PROBLEM",frozen.path("workload").asString());assertEquals(document.toString(),frozen.path("snapshot").path("origin").path("context").path("documentId").asString());assertEquals("USER",frozen.path("snapshot").path("origin").path("message").path("role").asString());assertEquals("Oblicz zadanie",frozen.path("snapshot").path("origin").path("message").path("content").asString());
        var state = reserve(context(false), Intent.EDIT, "Rozwiń tę propozycję", UUID.randomUUID());
        dispatcher.dispatchAvailable();
        assertEquals(
                "FAILED", turns.find(workspace, state.conversationId(), state.turnId()).status());
        assertEquals(
                0, jdbc.queryForObject("SELECT count(*) FROM analysis_executions", Integer.class));
        assertEquals(
                0, jdbc.queryForObject("SELECT count(*) FROM canvas_proposals", Integer.class));
    }

    void initializeRealtime() throws Exception {
        var credential = owner.json(owner.postJson(route + "/collaboration/credential", "{}"));
        String code =
                """
                import {HocuspocusProvider} from '@hocuspocus/provider';import * as Y from 'yjs';import WebSocket from 'ws';
                const doc=new Y.Doc();const p=new HocuspocusProvider({url:process.argv[1],name:process.argv[2],token:process.argv[3],document:doc,WebSocketPolyfill:WebSocket});
                const deadline=setTimeout(()=>process.exit(2),10000);p.on('synced',()=>{clearTimeout(deadline);p.destroy();doc.destroy();setTimeout(()=>process.exit(0),100);});
                """;
        var run =
                new ProcessBuilder(
                                "node",
                                "--input-type=module",
                                "-e",
                                code,
                                "ws://127.0.0.1:" + SIDECAR,
                                credential.path("room").asString(),
                                credential.path("token").asString())
                        .directory(Path.of("../collaboration").toFile())
                        .redirectErrorStream(true)
                        .start();
        assertTrue(run.waitFor(15, TimeUnit.SECONDS));
        assertEquals(0, run.exitValue(), new String(run.getInputStream().readAllBytes()));
    }

    @Test
    void canonicalYjsAcceptsAfterRoomClosesAndReplayCannotDuplicateBlocks() throws Exception {
        initializeRealtime();
        var p = propose(true, "Dodaj treść");
        UUID id = UUID.randomUUID();
        var first = accept(p, id);
        assertEquals(200, first.statusCode(), first.body());
        assertEquals(owner.json(first), owner.json(accept(p, id)));
        assertEquals(4, doc().at("/content/content").size());
        assertEquals(
                1,
                jdbc.queryForObject(
                        "SELECT count(*) FROM canvas_operations WHERE receipt IS NOT NULL",
                        Integer.class));
        assertEquals(
                409,
                owner.patchJson(
                                route,
                                "{\"title\":\"Canvas\",\"revision\":2,\"content\":{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\"}]}}")
                        .statusCode());
        var undone =
                owner.postJson(
                        route
                                + "/ai/operations/"
                                + owner.json(first).path("operationId").asString()
                                + "/undo",
                        json.writeValueAsString(new Undo(UUID.randomUUID())));
        assertEquals(200, undone.statusCode(), undone.body());
        assertEquals(2, doc().at("/content/content").size());
    }

    @Test
    void canonicalEpochChangeRejectsPendingApproval() throws Exception {
        initializeRealtime();
        var p = propose(true, "Dodaj treść");
        jdbc.update(
                "UPDATE collaboration_documents SET epoch=epoch+1 WHERE document_id=?", document);
        assertEquals(409, accept(p, UUID.randomUUID()).statusCode());
        assertEquals(
                0,
                jdbc.queryForObject(
                        "SELECT count(*) FROM canvas_operations WHERE receipt IS NOT NULL",
                        Integer.class));
    }

    @Test
    void browserProposalReviewAndBothStorageModes() throws Exception {
        Assumptions.assumeTrue(
                "true".equals(System.getenv("CANVAS_BROWSER_TESTS")),
                "Opt-in styled browser verification");
        for (String mode : List.of("legacy", "realtime")) {
            if ("realtime".equals(mode)) setup();
            var problem=(tools.jackson.databind.node.ObjectNode)json.readTree(Files.readString(Path.of("../contracts/analysis/computation-plan/v2/problem-create.json")));
            problem.put("clientRequestId",UUID.randomUUID().toString());String ap="/api/workspaces/"+workspace+"/analyses";
            var created=owner.postJson(ap,problem.toString());assertEquals(201,created.statusCode(),created.body());String aid=owner.json(created).path("id").asString();
            assertEquals(200,owner.postJson(ap+"/"+aid+"/plan","{}").statusCode());var queued=owner.postJson(ap+"/"+aid+"/execute","{}");assertEquals(202,queued.statusCode(),queued.body());problems.dispatch();
            var execution=owner.json(owner.get(ap+"/"+aid+"/executions")).get(0);assertEquals("SUCCEEDED",execution.path("status").asString(),execution.toString());
            var browser =
                    new ProcessBuilder("node", "e2e/canvas-proposals.cjs")
                            .directory(Path.of("../frontend").toFile())
                            .redirectErrorStream(true)
                            .redirectOutput(
                                    Path.of("target/canvas-proposals-" + mode + ".log").toFile());
            browser.environment()
                    .putAll(
                            Map.of(
                                    "E2E_BACKEND_URL",
                                    "http://localhost:" + port,
                                    "E2E_DOCUMENT_ROUTE",
                                    route,
                                    "E2E_FRONTEND_PORT",
                                    String.valueOf(BROWSER),
                                    "E2E_COLLABORATION_URL",
                                    "http://127.0.0.1:" + SIDECAR,
                                    "E2E_MODE",
                                    mode));
            browser.environment().put("E2E_PROBLEM_ANALYSIS",aid);browser.environment().put("E2E_PROBLEM_EXECUTION",execution.path("id").asString());
            var run = browser.start();
            long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(180);
            while (run.isAlive() && System.nanoTime() < deadline) {
                dispatcher.dispatchAvailable();
                exportDispatcher.dispatchAvailable();
                Thread.sleep(100);
            }
            if (run.isAlive()) run.destroyForcibly();
            assertFalse(run.isAlive());
            assertEquals(
                    0,
                    run.exitValue(),
                    Files.readString(Path.of("target/canvas-proposals-" + mode + ".log")));
        }
    }

    @Test
    void expansionSupersedesOnlyPendingVersionAndPreservesImmutableHistory() throws Exception {
        var original = doc().path("content");
        var first = propose(true, "Dodaj treść");
        var state = reserve(context(true), Intent.EDIT, "Dodaj więcej treści", first.id());
        dispatcher.dispatchAvailable();
        var ready = turns.find(workspace, state.conversationId(), state.turnId());
        assertEquals("PROPOSAL_READY", ready.status());
        var next =
                json.readValue(
                        owner.get(route + "/ai/proposals/" + ready.proposalId()).body(),
                        Proposal.class);
        assertEquals(first.id(), next.supersedes());
        assertEquals(first.contextId(), next.contextId());
        assertEquals(first.mode(), next.mode());
        assertEquals(
                "SUPERSEDED",
                owner.json(owner.get(route + "/ai/proposals/" + first.id()))
                        .path("state")
                        .asString());
        assertEquals(original, doc().path("content"));
        assertEquals(409, accept(first, UUID.randomUUID()).statusCode());
        assertEquals(200, accept(next, UUID.randomUUID()).statusCode());
        var history = owner.json(owner.get(conversations + "/" + state.conversationId()));
        assertEquals("EDIT_PROPOSAL", history.at("/messages/1/canvasResult/kind").asString());
    }

    @Test
    void acceptedReferenceUsesCurrentGeneratedBlocksAndCompensatedReferencesFailSafely()
            throws Exception {
        var first = propose(true, "Dodaj treść");
        var accepted = owner.json(accept(first, UUID.randomUUID()));
        jdbc.update(
                "UPDATE documents SET"
                        + " content=jsonb_set(content,'{content,1,content,0,text}','\"Human revised"
                        + " generated paragraph\"'),revision=revision+1 WHERE id=?",
                document);
        var state =
                reserve(
                        first.contextId(),
                        Intent.EDIT,
                        "Popraw wstawiony tekst",
                        UUID.fromString(accepted.path("operationId").asString()));
        dispatcher.dispatchAvailable();
        var ready = turns.find(workspace, state.conversationId(), state.turnId());
        assertEquals("PROPOSAL_READY", ready.status(), ready.toString());
        var next =
                json.readValue(
                        owner.get(route + "/ai/proposals/" + ready.proposalId()).body(),
                        Proposal.class);
        assertEquals(Mode.REPLACE_RANGE, next.mode());
        assertNotEquals(first.contextId(), next.contextId());
        assertEquals("Human revised generated paragraph", next.originalText());
        assertEquals(200, accept(next, UUID.randomUUID()).statusCode());
        assertTrue(doc().toString().contains("TARGET suffix"));
        assertEquals(4, doc().at("/content/content").size());
        var compensated =
                owner.postJson(
                        route
                                + "/ai/operations/"
                                + owner.json(owner.get(route + "/ai/proposals/" + next.id()))
                                        .path("operationId")
                                        .asString()
                                + "/undo",
                        json.writeValueAsString(new Undo(UUID.randomUUID())));
        assertEquals(200, compensated.statusCode(), compensated.body());
        var stale = reserve(first.contextId(), Intent.EDIT, "Popraw wstawiony tekst", next.id());
        dispatcher.dispatchAvailable();
        assertEquals(
                "FAILED", turns.find(workspace, stale.conversationId(), stale.turnId()).status());
    }

    @Test
    void invalidOutputFailsPaidStageOnceAndManualNewTurnCanSucceed() throws Exception {
        org.mockito.Mockito.doAnswer(
                        call -> {
                            var valid = (AuthoringContracts.Result) call.callRealMethod();
                            return new AuthoringContracts.Result(
                                    valid.schemaVersion(),
                                    UUID.randomUUID(),
                                    valid.templateId(),
                                    valid.templateHash(),
                                    valid.model(),
                                    valid.usage(),
                                    valid.providerRequestId(),
                                    valid.answer());
                        })
                .when(models)
                .author(org.mockito.ArgumentMatchers.any());
        var state = reserve(context(true), Intent.EDIT, "Dodaj treść", null);
        dispatcher.dispatchAvailable();
        dispatcher.dispatchAvailable();
        var failed = turns.find(workspace, state.conversationId(), state.turnId());
        assertEquals("FAILED", failed.status());
        assertEquals(
                dev.researchhub.shared.error.ApiErrorCode.AI_OUTPUT_INVALID, failed.failureCode());
        org.mockito.Mockito.verify(models, org.mockito.Mockito.times(1))
                .author(org.mockito.ArgumentMatchers.any());
        assertEquals(
                0, jdbc.queryForObject("SELECT count(*) FROM canvas_proposals", Integer.class));
        org.mockito.Mockito.doCallRealMethod()
                .when(models)
                .author(org.mockito.ArgumentMatchers.any());
        assertEquals("PENDING", propose(true, "Dodaj treść").state());
    }

    @Test
    void completedCompensationHasDurableIdentityAndASecondUndoCannotRun() throws Exception {
        var first = propose(true, "Dodaj treść");
        var accepted = owner.json(accept(first, UUID.randomUUID()));
        UUID undo = UUID.randomUUID();
        String path = route + "/ai/operations/" + accepted.path("operationId").asString() + "/undo";
        assertEquals(
                200, owner.postJson(path, json.writeValueAsString(new Undo(undo))).statusCode());
        assertEquals(
                undo.toString(),
                owner.json(owner.get(route + "/ai/proposals/" + first.id()))
                        .path("compensationId")
                        .asString());
        assertEquals(
                409,
                owner.postJson(path, json.writeValueAsString(new Undo(UUID.randomUUID())))
                        .statusCode());
        assertEquals(
                1,
                jdbc.queryForObject(
                        "SELECT count(*) FROM document_content_operations WHERE"
                                + " operation_type='AI_UNDONE'",
                        Integer.class));
    }

    @Test void stageAdmissionIsActualAndReplayDoesNotSpendAgain() throws Exception {
        var state=reserve(context(true),Intent.EDIT,"Dodaj treść",null);
        org.mockito.Mockito.verify(quotas,org.mockito.Mockito.never()).admit(org.mockito.ArgumentMatchers.any(),org.mockito.ArgumentMatchers.any(),org.mockito.ArgumentMatchers.eq(dev.researchhub.security.application.CostCategory.LLM),org.mockito.ArgumentMatchers.any());
        var work=turns.claim().orElseThrow();service.execute(work);
        var ready=turns.find(workspace,state.conversationId(),state.turnId());assertEquals("PROPOSAL_READY",ready.status());
        turns.reserve(workspace,caller,work.conversationId(),work.request());assertFalse(turns.beginModel(work));
        org.mockito.Mockito.verify(quotas,org.mockito.Mockito.times(1)).admit(org.mockito.ArgumentMatchers.any(),org.mockito.ArgumentMatchers.any(),org.mockito.ArgumentMatchers.eq(dev.researchhub.security.application.CostCategory.LLM),org.mockito.ArgumentMatchers.any());
        assertTrue(jdbc.queryForObject("SELECT count(*) FROM product_audit_events WHERE event_type='CANVAS_STAGE_COMPLETED'",Integer.class)>=3);
        assertFalse(jdbc.queryForObject("SELECT string_agg(metadata::text,'') FROM product_audit_events WHERE event_type='CANVAS_STAGE_COMPLETED'",String.class).contains("Dodaj treść"));
    }
    @Test void cancelDuringPaidModelCallFencesLateProposalAndRestart() throws Exception {
        var state=reserve(context(true),Intent.EDIT,"Dodaj treść",null);var work=turns.claim().orElseThrow();
        org.mockito.Mockito.doAnswer(call -> {
            var result=call.callRealMethod();turns.cancel(workspace,caller,state.conversationId(),state.turnId());return result;
        }).when(models).author(org.mockito.ArgumentMatchers.any());
        service.execute(work);
        assertEquals("CANCELLED",turns.find(workspace,state.conversationId(),state.turnId()).status());
        assertEquals(0,jdbc.queryForObject("SELECT count(*) FROM canvas_proposals",Integer.class));assertEquals(0,jdbc.queryForObject("SELECT count(*) FROM canvas_operations",Integer.class));
        jdbc.update("UPDATE canvas_turns SET started_at=now()-interval '10 minutes' WHERE id=?",state.turnId());assertTrue(turns.claim().isEmpty());
        assertEquals("Dodaj treść",jdbc.queryForObject("SELECT content FROM ai_messages WHERE role='USER'",String.class));
    }
    @Test void uncertainPaidLeaseIsNotRetriedAndFailureKeepsPrompt() throws Exception {
        var state=reserve(context(true),Intent.EDIT,"Dodaj treść",null);var work=turns.claim().orElseThrow();assertTrue(turns.beginModel(work));
        jdbc.update("UPDATE canvas_turns SET started_at=now()-interval '10 minutes' WHERE id=?",state.turnId());assertTrue(turns.claim().isEmpty());
        service.execute(work);var failed=turns.find(workspace,state.conversationId(),state.turnId());assertEquals("FAILED",failed.status());assertEquals(dev.researchhub.shared.error.ApiErrorCode.AI_UNAVAILABLE,failed.failureCode());
        org.mockito.Mockito.verify(models,org.mockito.Mockito.never()).author(org.mockito.ArgumentMatchers.any());assertEquals(0,jdbc.queryForObject("SELECT count(*) FROM canvas_proposals",Integer.class));
        assertEquals("Dodaj treść",jdbc.queryForObject("SELECT content FROM ai_messages WHERE role='USER'",String.class));
    }
    @org.junit.jupiter.params.ParameterizedTest @org.junit.jupiter.params.provider.EnumSource(value=dev.researchhub.shared.error.ApiErrorCode.class,names={"AI_UNAVAILABLE","AI_OUTPUT_INVALID","FORBIDDEN","RATE_LIMIT_EXCEEDED"})
    void failuresPublishNoProposalAndKeepTheSavedPrompt(dev.researchhub.shared.error.ApiErrorCode code) throws Exception {
        var state=reserve(context(true),Intent.EDIT,"Dodaj treść",null);
        if(code==dev.researchhub.shared.error.ApiErrorCode.RATE_LIMIT_EXCEEDED)org.mockito.Mockito.doThrow(new dev.researchhub.shared.error.ApiException(code,"Limit reached")).when(quotas).admit(org.mockito.ArgumentMatchers.any(),org.mockito.ArgumentMatchers.any(),org.mockito.ArgumentMatchers.eq(dev.researchhub.security.application.CostCategory.LLM),org.mockito.ArgumentMatchers.any());
        else if(code==dev.researchhub.shared.error.ApiErrorCode.FORBIDDEN)org.mockito.Mockito.doAnswer(call -> {var result=call.callRealMethod();jdbc.update("UPDATE workspace_members SET role='VIEWER' WHERE workspace_id=? AND user_id=?",workspace,caller);return result;}).when(models).author(org.mockito.ArgumentMatchers.any());
        else org.mockito.Mockito.doThrow(new dev.researchhub.ai.application.ModelFailure(code)).when(models).author(org.mockito.ArgumentMatchers.any());
        dispatcher.dispatchAvailable();var failed=turns.find(workspace,state.conversationId(),state.turnId());assertEquals("FAILED",failed.status());assertEquals(code,failed.failureCode());
        assertEquals(0,jdbc.queryForObject("SELECT count(*) FROM canvas_proposals",Integer.class));assertEquals(0,jdbc.queryForObject("SELECT count(*) FROM canvas_operations",Integer.class));
        dispatcher.dispatchAvailable();org.mockito.Mockito.verify(models,org.mockito.Mockito.times(code==dev.researchhub.shared.error.ApiErrorCode.RATE_LIMIT_EXCEEDED ? 0 : 1)).author(org.mockito.ArgumentMatchers.any());
        assertEquals("Dodaj treść",jdbc.queryForObject("SELECT content FROM ai_messages WHERE role='USER'",String.class));
    }

    CanvasOperationService.Commit candidate(CanvasOperationService.Loaded loaded) throws Exception {
        Path file = Files.createTempFile("canvas-frozen-operation-", ".json");
        try {
            Files.writeString(file, json.writeValueAsString(loaded));
            String code =
                    """
                    import {readFileSync} from 'node:fs';import * as Y from 'yjs';
                    import {reconstruct} from './dist/snapshot.js';import {applyCanvasPatch} from './dist/operations.js';
                    const loaded=JSON.parse(readFileSync(process.argv[1],'utf8'));const doc=reconstruct(loaded.state);
                    const content=applyCanvasPatch(doc,loaded.patch);console.log(JSON.stringify({state:Buffer.from(Y.encodeStateAsUpdate(doc)).toString('base64'),content:JSON.stringify(content)}));doc.destroy();
                    """;
            var run =
                    new ProcessBuilder("node", "--input-type=module", "-e", code, file.toString())
                            .directory(Path.of("../collaboration").toFile())
                            .redirectErrorStream(true)
                            .start();
            assertTrue(run.waitFor(10, TimeUnit.SECONDS));
            String out = new String(run.getInputStream().readAllBytes());
            assertEquals(0, run.exitValue(), out);
            var payload = json.readTree(out);
            return new CanvasOperationService.Commit(
                    loaded.operation().id(),
                    loaded.state().sequence(),
                    loaded.operation().epoch(),
                    payload.path("state").asString(),
                    payload.path("content").asString());
        } finally {
            Files.deleteIfExists(file);
        }
    }

    @Test
    void canonicalCommitChecksFrozenProjectionEncodingSequenceAndReplaysDurableReceipt()
            throws Exception {
        initializeRealtime();
        var first = propose(true, "Dodaj treść");
        var op =
                operations.accept(
                        workspace,
                        document,
                        caller,
                        first.id(),
                        new Accept(UUID.randomUUID(), first.versionHash()));
        var loaded = operations.load(op.id());
        var valid = candidate(loaded);
        var before = doc().path("content");
        assertThrows(
                dev.researchhub.shared.error.ConflictException.class,
                () ->
                        operations.commit(
                                new CanvasOperationService.Commit(
                                        op.id(),
                                        valid.sequence(),
                                        valid.epoch(),
                                        valid.state(),
                                        json.writeValueAsString(before))));
        assertThrows(
                dev.researchhub.shared.error.ApiException.class,
                () ->
                        operations.commit(
                                new CanvasOperationService.Commit(
                                        op.id(),
                                        valid.sequence(),
                                        valid.epoch(),
                                        "invalid base64!",
                                        valid.content())));
        assertThrows(
                dev.researchhub.shared.error.ConflictException.class,
                () ->
                        operations.commit(
                                new CanvasOperationService.Commit(
                                        op.id(),
                                        valid.sequence() + 100,
                                        valid.epoch(),
                                        valid.state(),
                                        valid.content())));
        assertThrows(
                dev.researchhub.shared.error.ApiException.class,
                () ->
                        operations.commit(
                                new CanvasOperationService.Commit(
                                        op.id(),
                                        valid.sequence(),
                                        valid.epoch() + 1,
                                        valid.state(),
                                        valid.content())));
        assertEquals(before, doc().path("content"));
        assertEquals(
                0,
                jdbc.queryForObject(
                        "SELECT count(*) FROM document_content_operations WHERE"
                                + " operation_type='AI_ACCEPTED'",
                        Integer.class));
        var committed = operations.commit(valid);
        var replay = operations.commit(valid);
        assertEquals(committed.receipt(), replay.receipt());
        assertEquals(committed.state().state(), replay.state().state());
        assertEquals(
                json.readTree(committed.state().content()),
                json.readTree(replay.state().content()));
        assertNull(operations.load(op.id()).patch());
        var received = accept(first, op.id());
        assertEquals(200, received.statusCode(), received.body());
        assertEquals(committed.receipt(), json.readValue(received.body(), Receipt.class));
        assertEquals(
                1,
                jdbc.queryForObject(
                        "SELECT count(*) FROM document_content_operations WHERE"
                                + " operation_type='AI_ACCEPTED'",
                        Integer.class));
    }

    @Test
    void canonicalRoleRevocationBeforeCommitRollsBackSnapshotAndProvenance() throws Exception {
        initializeRealtime();
        var first = propose(true, "Dodaj treść");
        var op =
                operations.accept(
                        workspace,
                        document,
                        caller,
                        first.id(),
                        new Accept(UUID.randomUUID(), first.versionHash()));
        var loaded = operations.load(op.id());
        var valid = candidate(loaded);
        var before = doc().path("content");
        jdbc.update(
                "UPDATE workspace_members SET role='VIEWER' WHERE workspace_id=? AND user_id=?",
                workspace,
                caller);
        assertThrows(
                dev.researchhub.shared.error.ForbiddenException.class,
                () -> operations.commit(valid));
        assertEquals(before, doc().path("content"));
        assertEquals(
                0,
                jdbc.queryForObject(
                        "SELECT count(*) FROM canvas_operations WHERE receipt IS NOT NULL",
                        Integer.class));
        assertEquals(
                0,
                jdbc.queryForObject(
                        "SELECT count(*) FROM document_content_operations WHERE"
                                + " operation_type='AI_ACCEPTED'",
                        Integer.class));
    }

    @Test
    void durableDatabaseFailurePublishesNeitherSnapshotNorProvenanceAndSameIdentityRecovers()
            throws Exception {
        initializeRealtime();
        var first = propose(true, "Dodaj treść");
        UUID id = UUID.randomUUID();
        var before = doc().path("content");
        jdbc.execute(
                "CREATE FUNCTION fail_canvas_provenance_test() RETURNS trigger LANGUAGE plpgsql AS"
                    + " $$ BEGIN IF NEW.operation_type='AI_ACCEPTED' THEN RAISE EXCEPTION 'injected"
                    + " durable write failure'; END IF; RETURN NEW; END $$");
        jdbc.execute(
                "CREATE TRIGGER fail_canvas_provenance_test BEFORE INSERT ON"
                    + " document_content_operations FOR EACH ROW EXECUTE FUNCTION"
                    + " fail_canvas_provenance_test()");
        try {
            var failed = accept(first, id);
            assertEquals(503, failed.statusCode(), failed.body());
            assertEquals(before, doc().path("content"));
            assertEquals(
                    "PENDING",
                    owner.json(owner.get(route + "/ai/proposals/" + first.id()))
                            .path("state")
                            .asString());
            assertEquals(
                    0,
                    jdbc.queryForObject(
                            "SELECT count(*) FROM canvas_operations WHERE receipt IS NOT NULL",
                            Integer.class));
            assertEquals(
                    0,
                    jdbc.queryForObject(
                            "SELECT count(*) FROM document_content_operations WHERE"
                                + " operation_type='AI_ACCEPTED'",
                            Integer.class));
        } finally {
            jdbc.execute("DROP TRIGGER fail_canvas_provenance_test ON document_content_operations");
            jdbc.execute("DROP FUNCTION fail_canvas_provenance_test()");
        }
        assertEquals(200, accept(first, id).statusCode());
        assertEquals(4, doc().at("/content/content").size());
    }

    @Test
    void typedResultCannotBePartialAndUnknownIntentsCannotDispatch() throws Exception {
        var first = propose(true, "Dodaj treść");
        for (String payload : List.of("{}", "{\"text\":\"mismatch\"}"))
            assertThrows(
                    org.springframework.dao.DataIntegrityViolationException.class,
                    () ->
                            jdbc.update(
                                    "UPDATE ai_messages SET canvas_result=?::jsonb WHERE"
                                        + " canvas_result IS NOT NULL",
                                    payload));
        UUID context = context(true);
        String bad =
                json.writeValueAsString(
                                new FirstTurn(
                                        "1.0",
                                        UUID.randomUUID(),
                                        context,
                                        new Turn(
                                                "1.0",
                                                UUID.randomUUID(),
                                                context,
                                                Intent.EDIT,
                                                "Dodaj treść",
                                                null,
                                                null,
                                                new Scope(List.of(), List.of()))))
                        .replace("\"EDIT\"", "\"DELETE_WORKSPACE\"");
        assertEquals(400, owner.postJson(conversations + "/contextual", bad).statusCode());
        assertEquals(1, jdbc.queryForObject("SELECT count(*) FROM canvas_turns", Integer.class));
        assertEquals(404, owner.get(route + "/ai/proposals/" + UUID.randomUUID()).statusCode());
        assertEquals(
                401,
                owner.postJson(
                                "/internal/collaboration/ai/load",
                                json.writeValueAsString(Map.of("operationId", first.id())))
                        .statusCode());
    }
}
