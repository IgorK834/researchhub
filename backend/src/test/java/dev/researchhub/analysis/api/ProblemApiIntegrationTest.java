package dev.researchhub.analysis.api;

import static org.junit.jupiter.api.Assertions.*;

import dev.researchhub.analysis.application.*;
import dev.researchhub.shared.infrastructure.persistence.PostgresTestcontainersConfiguration;
import dev.researchhub.support.ApiBrowser;

import org.junit.jupiter.api.*;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.*;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.*;

import tools.jackson.databind.*;
import tools.jackson.databind.node.ObjectNode;

import java.net.*;
import java.net.http.*;
import java.nio.file.*;
import java.time.Duration;
import java.util.*;

/** Real product HTTP -> PostgreSQL -> Python planning worker -> two isolated Docker attempts. */
@EnabledIfEnvironmentVariable(named = "ANALYSIS_SANDBOX_TESTS", matches = "true")
@SpringBootTest(
        webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = {
            "researchhub.processing.dispatcher.enabled=false",
            "researchhub.export.dispatcher.enabled=false",
            "researchhub.ai.canvas.dispatcher.enabled=false",
            "researchhub.analysis.execution.dispatcher.enabled=false",
            "researchhub.analysis.sandbox.enabled=true"
        })
@ActiveProfiles("local")
@Import(PostgresTestcontainersConfiguration.class)
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class ProblemApiIntegrationTest {
    static final int WORKER = freePort();
    static final String TOKEN = "scientific-problem-e2e-token-at-least-32-characters";
    Process worker;

    @DynamicPropertySource
    static void config(DynamicPropertyRegistry p) {
        p.add("researchhub.processing.worker.base-url", () -> "http://127.0.0.1:" + WORKER);
        p.add("researchhub.processing.worker.service-token", () -> TOKEN);
        p.add(
                "researchhub.analysis.sandbox.socket-path",
                () ->
                        System.getenv()
                                .getOrDefault(
                                        "ANALYSIS_SANDBOX_SOCKET_PATH", "/var/run/docker.sock"));
    }

    @Value("${local.server.port}")
    int port;

    @Autowired ObjectMapper json;
    @Autowired JdbcTemplate jdbc;
    @Autowired ProblemService problems;
    @Autowired ProblemStore problemStore;
    @Autowired dev.researchhub.export.application.ExportDispatcher exportDispatcher;
    @Autowired dev.researchhub.ai.application.CanvasTurnDispatcher canvasDispatcher;
    ApiBrowser owner, viewer, outsider;
    UUID workspace;
    String path;

    static int freePort() {
        try (var s = new java.net.ServerSocket(0)) {
            return s.getLocalPort();
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
    }

    @BeforeAll
    void start() throws Exception {
        var p =
                new ProcessBuilder(".venv/bin/python", "-m", "researchhub_worker")
                        .directory(Path.of("../ai-worker").toFile())
                        .redirectErrorStream(true)
                        .redirectOutput(Path.of("target/problem-worker.log").toFile());
        p.environment()
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
        worker = p.start();
        var client = HttpClient.newHttpClient();
        for (int i = 0; i < 50; i++) {
            try {
                if (client.send(
                                        HttpRequest.newBuilder(
                                                        URI.create(
                                                                "http://127.0.0.1:"
                                                                        + WORKER
                                                                        + "/health"))
                                                .GET()
                                                .timeout(Duration.ofSeconds(1))
                                                .build(),
                                        HttpResponse.BodyHandlers.discarding())
                                .statusCode()
                        == 200) return;
            } catch (Exception notReady) {
            }
            Thread.sleep(100);
        }
        fail("Worker failed to start");
    }

    @AfterAll
    void stop() throws Exception {
        if (worker != null) {
            worker.destroy();
            if (!worker.waitFor(5, java.util.concurrent.TimeUnit.SECONDS)) worker.destroyForcibly();
        }
    }

    @BeforeEach
    void setup() throws Exception {
        jdbc.execute("TRUNCATE users,workspaces CASCADE");
        owner = new ApiBrowser(port, json);
        viewer = new ApiBrowser(port, json);
        outsider = new ApiBrowser(port, json);
        owner.signUp("problem-owner@test.invalid", "Owner");
        viewer.signUp("problem-viewer@test.invalid", "Viewer");
        outsider.signUp("problem-outsider@test.invalid", "Outsider");
        workspace = UUID.fromString(owner.createdWorkspaceId("Scientific problems", "E2E"));
        path = "/api/workspaces/" + workspace + "/analyses";
        assertEquals(
                201,
                owner.postJson(
                                "/api/workspaces/" + workspace + "/members",
                                "{\"email\":\"problem-viewer@test.invalid\",\"role\":\"VIEWER\"}")
                        .statusCode());
    }

    ObjectNode command() throws Exception {
        var n =
                (ObjectNode)
                        json.readTree(
                                Files.readString(
                                        Path.of(
                                                "../contracts/analysis/computation-plan/v2/problem-create.json")));
        n.put("clientRequestId", UUID.randomUUID().toString());
        return n;
    }

    JsonNode create(ObjectNode n) throws Exception {
        var response = owner.postJson(path, json.writeValueAsString(n));
        assertEquals(201, response.statusCode(), response.body());
        return owner.json(response);
    }

    JsonNode run(String id) throws Exception {
        var planned = owner.postJson(path + "/" + id + "/plan", "{}");
        assertEquals(200, planned.statusCode(), planned.body());
        assertEquals(
                "READY_TO_EXECUTE", owner.json(planned).path("status").asString(), planned.body());
        var queued = owner.postJson(path + "/" + id + "/execute", "{}");
        assertEquals(202, queued.statusCode(), queued.body());
        var duplicate = owner.postJson(path + "/" + id + "/execute", "{}");
        assertEquals(202, duplicate.statusCode(), duplicate.body());
        assertEquals(owner.json(queued).path("id"), owner.json(duplicate).path("id"));
        problems.dispatch();
        return owner.json(owner.get(path + "/" + id + "/executions")).get(0);
    }

    @Test void electricalAndEliminationFixturesHaveIndependentExpectedValues() throws Exception {
        var cases=json.readTree(Files.readString(Path.of("../ai-worker/src/researchhub_worker/evaluation/fixtures/canvas-suite.json"))).path("cases");
        for(String name:List.of("ohm-01","quadratic-01","elimination-01")) {
            JsonNode fixture=null;for(var c:cases)if(c.path("id").asString().equals(name))fixture=c;
            assertNotNull(fixture);var n=command();n.set("problem",fixture.path("problem"));n.put("userPrompt",fixture.at("/problem/statement").asString());
            String id=create(n).path("id").asString();var e=run(id);assertEquals("SUCCEEDED",e.path("status").asString(),e.toString());
            var solution=owner.json(owner.get(path+"/"+id+"/executions/"+e.path("id").asString()+"/solution"));var steps=solution.path("steps");
            assertEquals("CHECKED",solution.at("/receipt/status").asString());
            if(name.equals("ohm-01")) {
                assertEquals(6.0,steps.get(0).path("values").get(0).asDouble(),1e-10);assertEquals("mA",steps.get(0).path("unit").asString());
                assertEquals(72.0,steps.get(1).path("values").get(0).asDouble(),1e-10);assertEquals("mW",steps.get(1).path("unit").asString());
                assertEquals("2000",steps.get(0).at("/substitution/R/siValue").asString());
                var points=solution.at("/plot/points");assertEquals(13,points.size());for(var point:points)assertEquals(point.get(0).asDouble()/2,point.get(1).asDouble(),1e-10);
                assertEquals("V",solution.at("/plot/xUnit").asString());assertEquals("mA",solution.at("/plot/yUnit").asString());
            } else if(name.equals("quadratic-01")) {
                assertEquals(2,steps.get(0).path("values").size());assertEquals(2.0,steps.get(0).path("values").get(0).asDouble(),1e-10);assertEquals(3.0,steps.get(0).path("values").get(1).asDouble(),1e-10);
                for(var value:steps.get(0).path("values")){double x=value.asDouble();assertEquals(0,x*x-5*x+6,1e-10);}
            } else {
                double x=steps.get(0).path("values").get(0).asDouble(),y=steps.get(1).path("values").get(0).asDouble();assertEquals(3,x,1e-10);assertEquals(2,y,1e-10);assertEquals(5,x+y,1e-10);assertEquals(1,x-y,1e-10);
            }
        }
    }

    @Test void missingIncompatibleAndZeroInputsPublishNoVerifiedResult() throws Exception {
        var cases=json.readTree(Files.readString(Path.of("../ai-worker/src/researchhub_worker/evaluation/fixtures/canvas-suite.json"))).path("cases");
        for(String name:List.of("missing-value","division-zero","incompatible-unit")) {
            JsonNode fixture=null;for(var c:cases)if(c.path("id").asString().equals(name))fixture=c;
            var n=command();n.set("problem",fixture.path("problem"));n.put("userPrompt",fixture.at("/problem/statement").asString());
            if(name.equals("incompatible-unit")) {
                assertEquals(400,owner.postJson(path,json.writeValueAsString(n)).statusCode());continue;
            }
            String id=create(n).path("id").asString();
            if(name.equals("missing-value")) {
                var planned=owner.postJson(path+"/"+id+"/plan","{}");assertEquals(200,planned.statusCode());assertEquals("WAITING_FOR_INPUT",owner.json(planned).path("status").asString());assertEquals(0,owner.json(owner.get(path+"/"+id+"/executions")).size());
            } else {var e=run(id);assertEquals("FAILED",e.path("status").asString());assertTrue(e.path("result").isNull());assertNotEquals("CHECKED",e.at("/verification/status").asString());}
        }
    }

    @Test void savedSolutionEvidenceAndCompletePackageAreHistoricalScopedAndAtomic() throws Exception {
        var a=create(command());String id=a.path("id").asString();var e=run(id);String eid=e.path("id").asString(),sp=path+"/"+id+"/executions/"+eid+"/solution";
        var solution=owner.get(sp);assertEquals(200,solution.statusCode(),solution.body());var bundle=owner.json(solution);
        assertEquals("SOLUTION",bundle.path("kind").asString());assertEquals("NOT_CHECKED",bundle.at("/interpretation/status").asString());
        assertEquals(0.5,bundle.at("/steps/0/values/0").asDouble(),1e-12);assertEquals("1",bundle.at("/steps/0/substitution/distance/siValue").asString());
        assertEquals(64,bundle.at("/codeHashes/problem.py").asString().length());assertEquals(e.path("inputHash"),bundle.path("inputHash"));
        assertEquals(200,viewer.get(sp).statusCode());assertEquals(404,outsider.get(sp).statusCode());assertEquals(404,owner.get(sp.replace(eid,UUID.randomUUID().toString())).statusCode());
        assertThrows(org.springframework.dao.DataAccessException.class,()->jdbc.update("UPDATE problem_executions SET payload=jsonb_set(payload,'{solution,steps,0,unit}','\"cm\"') WHERE id=?",UUID.fromString(eid)));
        var created=owner.postJson("/api/workspaces/"+workspace+"/documents","""
            {"title":"Solution report","content":{"type":"doc","content":[{"type":"paragraph","attrs":{"blockId":"00000001-0000-4000-8000-000000000001"},"content":[{"type":"text","text":"prefix TARGET suffix"}]},{"type":"paragraph","content":[{"type":"text","text":"OUTSIDE"}]}]}}
            """);assertEquals(201,created.statusCode(),created.body());String dp="/api/workspaces/"+workspace+"/documents/"+owner.json(created).path("id").asString();
        var endpoint=new dev.researchhub.document.application.CanvasTargets.Endpoint("00000001-0000-4000-8000-000000000001",List.of(0),7);
        var target=new dev.researchhub.document.application.CanvasTargets.Target(dev.researchhub.document.application.CanvasTargets.Kind.CARET,endpoint,endpoint,dev.researchhub.document.application.CanvasDocumentTarget.hash("prefix \0TARGET suffix"));
        var captured=owner.postJson(dp+"/ai/contexts",json.writeValueAsString(new dev.researchhub.ai.application.CanvasContracts.Capture("1.0",UUID.randomUUID(),1,null,null,null,null,target)));
        assertEquals(200,captured.statusCode(),captured.body());UUID context=UUID.fromString(owner.json(captured).path("contextId").asString());
        UUID pid=UUID.randomUUID();var request=new dev.researchhub.ai.application.CalculationPackageContracts.Request(pid,context,UUID.fromString(id),UUID.fromString(eid),dev.researchhub.ai.application.CalculationPackageContracts.Selection.FULL,null,null,null);
        var preview=owner.postJson(dp+"/ai/proposals/calculation",json.writeValueAsString(request));assertEquals(200,preview.statusCode(),preview.body());var p=owner.json(preview);
        assertEquals(p,owner.json(owner.postJson(dp+"/ai/proposals/calculation",json.writeValueAsString(request))));
        assertEquals(6,p.at("/calculation/blocks").size());assertEquals(bundle.at("/steps/0/id"),p.at("/calculation/blocks/1/attrs/reference/stepId"));
        for(var selection:List.of(dev.researchhub.ai.application.CalculationPackageContracts.Selection.TABLE,dev.researchhub.ai.application.CalculationPackageContracts.Selection.CHART)) {
            var selected=new dev.researchhub.ai.application.CalculationPackageContracts.Request(UUID.randomUUID(),context,UUID.fromString(id),UUID.fromString(eid),selection,selection.name().equals("TABLE")?"plot-data":"plot",null,null);
            var only=owner.postJson(dp+"/ai/proposals/calculation",json.writeValueAsString(selected));assertEquals(200,only.statusCode(),only.body());assertEquals(1,owner.json(only).at("/calculation/blocks").size());
        }
        var reused=new dev.researchhub.ai.application.CalculationPackageContracts.Request(pid,context,UUID.fromString(id),UUID.fromString(eid),dev.researchhub.ai.application.CalculationPackageContracts.Selection.CHART,"plot",null,null);
        assertEquals(409,owner.postJson(dp+"/ai/proposals/calculation",json.writeValueAsString(reused)).statusCode());
        var original=owner.json(owner.get(dp)).path("content");
        var bad=new dev.researchhub.ai.application.CalculationPackageContracts.Request(UUID.randomUUID(),context,UUID.fromString(id),UUID.fromString(eid),dev.researchhub.ai.application.CalculationPackageContracts.Selection.CHART,"foreign-output",null,null);
        assertEquals(400,owner.postJson(dp+"/ai/proposals/calculation",json.writeValueAsString(bad)).statusCode());assertEquals(original,owner.json(owner.get(dp)).path("content"));
        assertEquals(403,viewer.postJson(dp+"/ai/proposals/calculation",json.writeValueAsString(request)).statusCode());assertEquals(404,outsider.postJson(dp+"/ai/proposals/calculation",json.writeValueAsString(request)).statusCode());
        UUID operation=UUID.randomUUID();String accept=json.writeValueAsString(new dev.researchhub.ai.application.CanvasProposalContracts.Accept(operation,p.path("versionHash").asString()));
        var accepted=owner.postJson(dp+"/ai/proposals/"+pid+"/accept",accept);assertEquals(200,accepted.statusCode(),accepted.body());assertEquals(owner.json(accepted),owner.json(owner.postJson(dp+"/ai/proposals/"+pid+"/accept",accept)));
        var saved=owner.json(owner.get(dp));var blocks=saved.at("/content/content");assertEquals("prefix ",blocks.get(0).at("/content/0/text").asString());assertEquals("TARGET suffix",blocks.get(7).at("/content/0/text").asString());assertEquals("OUTSIDE",blocks.get(8).at("/content/0/text").asString());
        var ids=new HashSet<String>();for(int i=1;i<=6;i++){assertEquals(eid,blocks.get(i).at("/attrs/reference/executionId").asString());ids.add(blocks.get(i).at("/attrs/blockId").asString());}assertEquals(6,ids.size());
        assertEquals(bundle,owner.json(owner.get(sp)));assertEquals(1,owner.json(owner.get(path+"/"+id+"/executions")).size());
        var exports=new LinkedHashMap<String,String>();
        var snapshots=new HashMap<String,JsonNode>();var artifacts=new HashMap<String,byte[]>();
        for(String format:List.of("DOCX","PDF","LATEX")) {
            var job=viewer.postJson(dp+"/exports",json.writeValueAsString(Map.of("format",format,"revision",saved.path("revision").asLong())));
            assertEquals(202,job.statusCode(),job.body());String jobId=viewer.json(job).path("id").asString();exports.put(format,jobId);
            var frozen=viewer.json(viewer.get(dp+"/exports/"+jobId+"/representation"));assertEquals("2.0",frozen.path("schemaVersion").asString());snapshots.put(jobId,frozen);
            assertTrue(frozen.toString().contains(bundle.path("inputHash").asString()));assertTrue(frozen.toString().contains(bundle.at("/steps/0/id").asString()));
            exportDispatcher.dispatchAvailable();var download=viewer.getBytes(dp+"/exports/"+jobId+"/download");assertEquals(200,download.statusCode());artifacts.put(jobId,download.body());
            java.nio.file.Files.createDirectories(Path.of("target/export-qa"));java.nio.file.Files.write(Path.of("target/export-qa/native-solution."+(format.equals("LATEX") ? "zip" : format.toLowerCase())),download.body());
            if(format.equals("DOCX"))try(var word=new org.apache.poi.xwpf.usermodel.XWPFDocument(new java.io.ByteArrayInputStream(download.body()))) {
                assertTrue(word.getDocument().xmlText().contains("oMath"));assertEquals(1,word.getAllPictures().size());
                assertTrue(word.getDocument().xmlText().contains(eid));assertTrue(word.getDocument().xmlText().contains("SI = 1"));
            } else if(format.equals("PDF"))try(var pdf=org.apache.pdfbox.Loader.loadPDF(download.body())) {
                String text=new org.apache.pdfbox.text.PDFTextStripper().getText(pdf);assertTrue(text.replaceAll("\\s", "").contains(eid));assertTrue(text.contains("0.5"));assertTrue(text.contains("NOT_CHECKED"));
            }
        }
        assertEquals(1,owner.json(owner.get(path+"/"+id+"/executions")).size(),"Export must not execute again");
        var next=owner.postJson(path+"/"+id+"/problem/executions/"+eid+"/reproduce","{}");assertEquals(202,next.statusCode(),next.body());problems.dispatch();
        assertEquals(saved.path("content"),owner.json(owner.get(dp)).path("content"));assertEquals(bundle,owner.json(owner.get(sp)));
        var invalid=saved.path("content").deepCopy();((ObjectNode)invalid.at("/content/2/attrs/reference")).put("stepId",UUID.randomUUID().toString());
        assertEquals(400,owner.patchJson(dp,json.writeValueAsString(Map.of("title","Solution report","revision",saved.path("revision").asLong(),"content",invalid))).statusCode());assertEquals(saved.path("content"),owner.json(owner.get(dp)).path("content"));
        var undone=owner.postJson(dp+"/ai/operations/"+operation+"/undo",json.writeValueAsString(new dev.researchhub.ai.application.CanvasProposalContracts.Undo(UUID.randomUUID())));assertEquals(200,undone.statusCode(),undone.body());assertEquals(original,owner.json(owner.get(dp)).path("content"));
        // The saved proposal cannot be replayed into a changed target under a new operation ID.
        var staleRequest=new dev.researchhub.ai.application.CalculationPackageContracts.Request(UUID.randomUUID(),context,UUID.fromString(id),UUID.fromString(eid),dev.researchhub.ai.application.CalculationPackageContracts.Selection.CHART,"plot",null,null);
        var stalePreview=owner.postJson(dp+"/ai/proposals/calculation",json.writeValueAsString(staleRequest));assertEquals(200,stalePreview.statusCode(),stalePreview.body());var stale=owner.json(stalePreview);
        jdbc.update("UPDATE documents SET content=jsonb_set(content,'{content,0,content,0,text}','\"changed target\"'),revision=revision+1 WHERE id=?",UUID.fromString(owner.json(created).path("id").asString()));var changedDoc=owner.json(owner.get(dp));
        assertEquals(409,owner.postJson(dp+"/ai/proposals/"+stale.path("id").asString()+"/accept",json.writeValueAsString(new dev.researchhub.ai.application.CanvasProposalContracts.Accept(UUID.randomUUID(),stale.path("versionHash").asString()))).statusCode());assertEquals(changedDoc,owner.json(owner.get(dp)));
        var question=new dev.researchhub.ai.application.QuestionContracts.Question("Explain this computed speed and distinguish assumptions",List.of(),List.of(new dev.researchhub.analysis.application.AnalysisEvidenceService.Reference(UUID.fromString(id),UUID.fromString(eid),"solution")));
        var answer=owner.postJson("/api/workspaces/"+workspace+"/ai/questions",json.writeValueAsString(question));assertEquals(200,answer.statusCode(),answer.body());var response=owner.json(answer);
        assertEquals("PROBLEM",response.at("/analysisCitations/0/problem/workload").asString());assertEquals(0,response.at("/analysisCitations/0/inputSources").size());assertEquals("NOT_CHECKED",response.at("/analysisCitations/0/problem/interpretationStatus").asString());
        assertEquals(2,owner.json(owner.get(path+"/"+id+"/executions")).size());
        for(String jobId:exports.values()) {
            assertEquals(snapshots.get(jobId),viewer.json(viewer.get(dp+"/exports/"+jobId+"/representation")),"Frozen representation survives reproduction and undo");
            assertArrayEquals(artifacts.get(jobId),viewer.getBytes(dp+"/exports/"+jobId+"/download").body(),"Downloaded artifact is immutable");
        }
    }

    @Test
    void numericUnitsPlotFreshVerificationReproductionAndAuthorization() throws Exception {
        var a = create(command());
        String id = a.path("id").asString();
        var e = run(id);
        assertEquals("SUCCEEDED", e.path("status").asString(), e.toString());
        assertEquals(
                0.5,
                e.path("result").path("outputs").get(0).path("values").get(0).asDouble(),
                1e-10);
        assertEquals("CHECKED", e.path("verification").path("status").asString());
        assertCheckedMath(e);
        assertThrows(
                dev.researchhub.shared.error.ConflictException.class,
                () ->
                        problemStore.complete(
                                workspace,
                                json.treeToValue(
                                        e,
                                        dev.researchhub.analysis.application.ProblemContracts
                                                .Execution.class),
                                Map.of()));
        jdbc.update(
                "INSERT INTO"
                    + " problem_artifacts(id,workspace_id,analysis_id,execution_id,name,media_type,sha256,content)"
                    + " VALUES(?,?,?,?,?,'image/png',?,?)",
                UUID.randomUUID(),
                workspace,
                UUID.fromString(id),
                UUID.fromString(e.path("id").asString()),
                "tampered.png",
                "f".repeat(64),
                new byte[] {1});
        assertEquals(
                409,
                owner.getBytes(
                                path
                                        + "/"
                                        + id
                                        + "/problem/executions/"
                                        + e.path("id").asString()
                                        + "/artifacts/tampered.png")
                        .statusCode());
        assertEquals(
                200,
                owner.get(path + "/" + id + "/executions/" + e.path("id").asString() + "/record")
                        .statusCode());
        assertEquals(
                200,
                owner.get(path + "/" + id + "/executions/" + e.path("id").asString()).statusCode());
        assertEquals(200, owner.get(path + "/" + id + "/plans").statusCode());
        assertEquals(200, owner.get(path).statusCode());
        assertEquals(11, e.path("verification").path("receipt").path("checkedPoints").asInt());
        assertEquals("1.2.0", e.path("runtimeVersion").asString());
        String artifact =
                path
                        + "/"
                        + id
                        + "/problem/executions/"
                        + e.path("id").asString()
                        + "/artifacts/plot.png";
        assertEquals(200, viewer.getBytes(artifact).statusCode());
        assertEquals(404, outsider.getBytes(artifact).statusCode());
        assertEquals(403, viewer.postJson(path + "/" + id + "/execute", "{}").statusCode());
        var replay =
                owner.postJson(
                        path
                                + "/"
                                + id
                                + "/problem/executions/"
                                + e.path("id").asString()
                                + "/reproduce",
                        "{}");
        assertEquals(202, replay.statusCode(), replay.body());
        problems.dispatch();
        var history = owner.json(owner.get(path + "/" + id + "/executions"));
        assertEquals(2, history.size());
        assertEquals(e.path("result"), history.get(1).path("result"));
        assertEquals(e.path("imageId"), history.get(1).path("imageId"));
        assertEquals(
                1,
                jdbc.queryForObject(
                        "SELECT count(*) FROM analysis_problems WHERE payload->'audit' IS NOT NULL",
                        Integer.class));
        assertEquals(0, jdbc.queryForObject("SELECT count(*) FROM analysis_inputs", Integer.class));
        assertThrows(
                org.springframework.dao.DataAccessException.class,
                () ->
                        jdbc.update(
                                "UPDATE problem_executions SET payload='{}'::jsonb WHERE id=?",
                                UUID.fromString(e.path("id").asString())));
    }

    @Test
    void polynomialSolvingWithoutDataset() throws Exception {
        var c = command();
        var p = (ObjectNode) c.path("problem");
        p.putNull("plot");
        p.set("parameters", json.createArrayNode());
        p.set("unknowns", json.readTree("[{\"symbol\":\"x\",\"unit\":\"1\"}]"));
        p.set(
                "expectedOutputs",
                json.readTree(
                        "[{\"name\":\"roots\",\"kind\":\"SOLVE\",\"expression\":{\"op\":\"eq\",\"left\":{\"op\":\"pow\",\"base\":{\"op\":\"symbol\",\"name\":\"x\"},\"exponent\":2},\"right\":{\"op\":\"number\",\"value\":\"4\"}},\"unit\":\"1\"}]"));
        var a = create(c);
        var e = run(a.path("id").asString());
        assertEquals("SUCCEEDED", e.path("status").asString(), e.toString());
        assertEquals(
                json.readTree("[-2.0,2.0]"),
                e.path("result").path("outputs").get(0).path("values"));
    }

    @Test
    void missingDomainUnitValueWaitsWithoutExecutionAndChangedInputCreatesLineage()
            throws Exception {
        var c = command();
        var p = (ObjectNode) c.path("problem");
        p.putNull("domain");
        ((ObjectNode) p.path("parameters").get(0)).putNull("unit").putNull("value");
        var a = create(c);
        String id = a.path("id").asString();
        assertEquals("WAITING_FOR_INPUT", a.path("status").asString());
        assertEquals(3, a.path("missing").size());
        assertEquals(200, owner.postJson(path + "/" + id + "/plan", "{}").statusCode());
        assertEquals(409, owner.postJson(path + "/" + id + "/execute", "{}").statusCode());
        assertEquals(
                0, jdbc.queryForObject("SELECT count(*) FROM problem_executions", Integer.class));
        var next = command();
        next.put("parentAnalysisId", id);
        var derived = create(next);
        assertEquals(id, derived.path("parentAnalysisId").asString());
        assertNotEquals(
                a.path("snapshot").path("inputHash"), derived.path("snapshot").path("inputHash"));
        assertEquals(a, owner.json(owner.get(path + "/" + id)));
        assertThrows(
                org.springframework.dao.DataAccessException.class,
                () ->
                        jdbc.update(
                                "UPDATE analysis_problems SET command='{}'::jsonb WHERE"
                                        + " analysis_id=?",
                                UUID.fromString(id)));
    }

    @Test
    void exactIdempotencyAndHostileSchemaScopeNumbersUnits() throws Exception {
        var c = command();
        var first = create(c);
        assertEquals(first, create(c));
        c.put("userPrompt", "different");
        assertEquals(409, owner.postJson(path, json.writeValueAsString(c)).statusCode());
        for (String value : List.of("1,2", "NaN", "Infinity", "-0", "1.0")) {
            var bad = command();
            ((ObjectNode) bad.path("problem").path("parameters").get(0)).put("value", value);
            assertEquals(400, owner.postJson(path, json.writeValueAsString(bad)).statusCode());
        }
        var numeric = command();
        ((ObjectNode) numeric.path("problem").path("parameters").get(0)).put("value", 100);
        assertEquals(400, owner.postJson(path, numeric.toString()).statusCode());
        var implicitUnit = command();
        ((ObjectNode) implicitUnit.path("problem").path("parameters").get(0)).put("unit", 1);
        assertEquals(400, owner.postJson(path, implicitUnit.toString()).statusCode());
        var incompatible = command();
        ((ObjectNode) incompatible.path("problem").path("expectedOutputs").get(0))
                .put("unit", "kg");
        assertEquals(400, owner.postJson(path, json.writeValueAsString(incompatible)).statusCode());
        var hostile = command();
        ((ObjectNode) hostile.path("problem").path("expectedOutputs").get(0))
                .set(
                        "expression",
                        json.readTree("{\"op\":\"eval\",\"code\":\"__import__('os')\"}"));
        assertEquals(400, owner.postJson(path, json.writeValueAsString(hostile)).statusCode());
        var foreign = command();
        foreign.set(
                "origin",
                json.readTree(
                        "{\"documentId\":\""
                                + UUID.randomUUID()
                                + "\",\"contextId\":\""
                                + UUID.randomUUID()
                                + "\",\"conversationId\":null,\"messageId\":null}"));
        assertEquals(404, owner.postJson(path, json.writeValueAsString(foreign)).statusCode());
        assertEquals(403, viewer.postJson(path, json.writeValueAsString(command())).statusCode());
        assertEquals(404, outsider.get(path + "/" + first.path("id").asString()).statusCode());
    }

    @Test
    void zeroDivisionFailsWithoutPublishingAndNextAttemptIsHealthy() throws Exception {
        var c = command();
        ((ObjectNode) c.path("problem").path("parameters").get(1)).put("value", "0");
        var a = create(c);
        var e = run(a.path("id").asString());
        assertEquals("FAILED", e.path("status").asString());
        assertTrue(e.path("result").isNull());
        assertTrue(e.path("verification").isNull());
        assertEquals(
                0, jdbc.queryForObject("SELECT count(*) FROM problem_artifacts", Integer.class));
        var healthy = create(command());
        assertEquals("SUCCEEDED", run(healthy.path("id").asString()).path("status").asString());
    }

    @Test
    void realProductionBrowserProblemFlow() throws Exception {
        Assumptions.assumeTrue("true".equals(System.getenv("CANVAS_BROWSER_TESTS")));
        int browserPort = freePort();
        var p =
                new ProcessBuilder("node", "e2e/scientific-problem.cjs")
                        .directory(Path.of("../frontend").toFile())
                        .redirectErrorStream(true)
                        .redirectOutput(Path.of("target/scientific-problem-browser.log").toFile());
        p.environment()
                .putAll(
                        Map.of(
                                "E2E_BACKEND_URL",
                                "http://localhost:" + port,
                                "E2E_FRONTEND_PORT",
                                String.valueOf(browserPort),
                                "E2E_WORKSPACE_ID",
                                workspace.toString()));
        var process = p.start();
        long deadline = System.nanoTime() + java.util.concurrent.TimeUnit.SECONDS.toNanos(150);
        while (process.isAlive() && System.nanoTime() < deadline) {
            problems.dispatch();
            Thread.sleep(100);
        }
        if (process.isAlive()) process.destroyForcibly();
        assertFalse(process.isAlive());
        assertEquals(
                0,
                process.exitValue(),
                Files.readString(Path.of("target/scientific-problem-browser.log")));
    }

    @Test
    void mathContextAndProblemSnapshotRemainExactAfterDocumentChange() throws Exception {
        var c = command();
        var ast = c.path("problem").path("expectedOutputs").get(0).path("expression");
        var math =
                json.createObjectNode()
                        .put("schemaVersion", "1.0")
                        .put("notation", dev.researchhub.shared.math.MathAst.notation(ast))
                        .put("accessibleText", dev.researchhub.shared.math.MathAst.plain(ast))
                        .putNull("verification");
        math.set("ast", ast);
        String block = UUID.randomUUID().toString();
        var node = json.createObjectNode().put("type", "blockMath");
        node.set("attrs", json.createObjectNode().put("blockId", block).set("math", math));
        var content = json.createObjectNode().put("type", "doc");
        content.set("content", json.createArrayNode().add(node));
        var docCommand = json.createObjectNode().put("title", "Frozen formula");
        docCommand.set("content", content);
        String docs = "/api/workspaces/" + workspace + "/documents";
        var created = owner.postJson(docs, docCommand.toString());
        assertEquals(201, created.statusCode(), created.body());
        String document = owner.json(created).path("id").asString();
        String contexts = docs + "/" + document + "/ai/contexts";
        var endpoint =
                new dev.researchhub.document.application.CanvasTargets.Endpoint(
                        block, List.of(0), 0);
        var end =
                new dev.researchhub.document.application.CanvasTargets.Endpoint(
                        block, List.of(0), 1);
        var target =
                new dev.researchhub.document.application.CanvasTargets.Target(
                        dev.researchhub.document.application.CanvasTargets.Kind.TEXT,
                        endpoint,
                        end,
                        dev.researchhub.document.application.CanvasDocumentTarget.hash("\uFFFC"));
        var capture =
                new dev.researchhub.ai.application.CanvasContracts.Capture(
                        "1.0", UUID.randomUUID(), 1, null, null, null, null, target);
        var captured = owner.postJson(contexts, json.writeValueAsString(capture));
        assertEquals(200, captured.statusCode(), captured.body());
        var context = owner.json(captured);
        assertEquals(math, context.path("snapshot").path("formulas").get(0));
        var contextId = UUID.fromString(context.path("contextId").asString());
        var turn =
                new dev.researchhub.ai.application.CanvasConversationContracts.Turn(
                        "1.0",
                        UUID.randomUUID(),
                        contextId,
                        dev.researchhub.ai.application.CanvasConversationContracts.Intent.SOLVE,
                        "Calculate the saved speed formula",
                        null,
                        null,
                        new dev.researchhub.ai.application.CanvasConversationContracts.Scope(
                                List.of(), List.of()));
        var first =
                new dev.researchhub.ai.application.CanvasConversationContracts.FirstTurn(
                        "1.0", UUID.randomUUID(), contextId, turn);
        var reserved =
                owner.postJson(
                        "/api/workspaces/" + workspace + "/ai/conversations/contextual",
                        json.writeValueAsString(first));
        assertEquals(202, reserved.statusCode(), reserved.body());
        canvasDispatcher.dispatchAvailable();
        var state = owner.json(reserved);
        var finished =
                owner.json(
                        owner.get(
                                "/api/workspaces/"
                                        + workspace
                                        + "/ai/conversations/"
                                        + state.path("conversationId").asString()
                                        + "/turns/"
                                        + state.path("turnId").asString()));
        assertEquals("WAITING_FOR_INPUT", finished.path("status").asString());
        var handoff = owner.json(owner.get(path + "/" + finished.path("analysisId").asString()));
        assertEquals(
                ast,
                handoff.path("snapshot")
                        .path("problem")
                        .path("expectedOutputs")
                        .get(0)
                        .path("expression"));
        assertTrue(
                handoff.path("snapshot")
                        .path("problem")
                        .path("statement")
                        .asString()
                        .contains("distance / time"));
        assertEquals(
                "Calculate the saved speed formula",
                handoff.path("snapshot").path("origin").path("message").path("content").asString());
        assertEquals(
                0, jdbc.queryForObject("SELECT count(*) FROM problem_executions", Integer.class));
        c.set(
                "origin",
                json.createObjectNode()
                        .put("documentId", document)
                        .put("contextId", context.path("contextId").asString())
                        .putNull("conversationId")
                        .putNull("messageId"));
        var analysis = create(c);
        assertEquals(
                1,
                analysis.path("snapshot").path("origin").path("context").path("revision").asInt());
        var changed = json.readTree("{\"op\":\"number\",\"value\":\"2\"}");
        math.set("ast", changed);
        math.put("notation", "2").put("accessibleText", "2");
        jdbc.update(
                "UPDATE documents SET content=?::jsonb,revision=revision+1 WHERE id=?",
                content.toString(),
                UUID.fromString(document));
        assertEquals(
                409,
                owner.postJson(
                                contexts + "/" + context.path("contextId").asString() + "/resolve",
                                "{}")
                        .statusCode());
        assertEquals(analysis, owner.json(owner.get(path + "/" + analysis.path("id").asString())));
        assertThrows(
                org.springframework.dao.DataAccessException.class,
                () ->
                        jdbc.update(
                                "UPDATE analysis_problems SET"
                                        + " payload=jsonb_set(payload,'{userPrompt}','\"changed\"')"
                                        + " WHERE analysis_id=?",
                                UUID.fromString(analysis.path("id").asString())));
    }

    @Test
    void interruptedPlanningAndExecutionAreFailedWithoutAutomaticRepeat() throws Exception {
        var a = create(command());
        String id = a.path("id").asString();
        assertEquals(200, owner.postJson(path + "/" + id + "/plan", "{}").statusCode());
        var queued = owner.postJson(path + "/" + id + "/execute", "{}");
        assertEquals(202, queued.statusCode(), queued.body());
        jdbc.update(
                "UPDATE problem_executions SET status='RUNNING',started_at=now()-interval '11"
                        + " minutes' WHERE id=?",
                UUID.fromString(owner.json(queued).path("id").asString()));
        var pending = create(command());
        jdbc.update(
                "UPDATE analysis_problems SET"
                    + " payload=jsonb_set(payload,'{status}','\"PLANNING\"'),planning_started_at=now()-interval"
                    + " '11 minutes' WHERE analysis_id=?",
                UUID.fromString(pending.path("id").asString()));
        problems.dispatch();
        assertEquals(
                "FAILED",
                owner.json(owner.get(path + "/" + pending.path("id").asString()))
                        .path("status")
                        .asString());
        var e = owner.json(owner.get(path + "/" + id + "/executions")).get(0);
        assertEquals("EXECUTION_INTERRUPTED", e.path("failureCode").asString());
        assertTrue(e.path("result").isNull());
        assertEquals(
                1, jdbc.queryForObject("SELECT count(*) FROM problem_executions", Integer.class));
    }

    void assertCheckedMath(JsonNode execution) throws Exception {
        var ast = execution.path("result").path("outputs").get(0).path("expression");
        var reference =
                json.createObjectNode()
                        .put("analysisId", execution.path("analysisId").asString())
                        .put("executionId", execution.path("id").asString())
                        .put("outputName", "result")
                        .put("stepIndex", 0)
                        .put("inputHash", execution.path("inputHash").asString());
        var math =
                json.createObjectNode()
                        .put("schemaVersion", "1.0")
                        .put("notation", dev.researchhub.shared.math.MathAst.notation(ast))
                        .put("accessibleText", dev.researchhub.shared.math.MathAst.plain(ast));
        math.set("ast", ast);
        math.set("verification", reference);
        var block = json.createObjectNode().put("type", "blockMath");
        block.set(
                "attrs",
                json.createObjectNode()
                        .put("blockId", UUID.randomUUID().toString())
                        .set("math", math));
        var content = json.createObjectNode().put("type", "doc");
        content.set("content", json.createArrayNode().add(block));
        var command = json.createObjectNode().put("title", "Checked speed");
        command.set("content", content);
        String docs = "/api/workspaces/" + workspace + "/documents";
        var saved = owner.postJson(docs, command.toString());
        assertEquals(201, saved.statusCode(), saved.body());
        assertEquals(
                200, viewer.get(docs + "/" + owner.json(saved).path("id").asString()).statusCode());
        reference.put("executionId", UUID.randomUUID().toString());
        assertEquals(400, owner.postJson(docs, command.toString()).statusCode());
        reference.put("executionId", execution.path("id").asString()).put("stepIndex", 1);
        assertEquals(400, owner.postJson(docs, command.toString()).statusCode());
        assertThrows(
                org.springframework.dao.DataAccessException.class,
                () ->
                        jdbc.update(
                                "UPDATE problem_artifacts SET sha256=? WHERE execution_id=?",
                                "f".repeat(64),
                                UUID.fromString(execution.path("id").asString())));
    }
}
