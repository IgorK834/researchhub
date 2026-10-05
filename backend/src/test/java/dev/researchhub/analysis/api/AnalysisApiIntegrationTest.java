package dev.researchhub.analysis.api;

import dev.researchhub.analysis.application.*;
import dev.researchhub.analysis.application.AnalysisContracts.*;
import dev.researchhub.ai.application.GenerationContracts.*;
import dev.researchhub.shared.infrastructure.persistence.PostgresTestcontainersConfiguration;
import dev.researchhub.source.SourceRowFixture;
import dev.researchhub.source.application.*;
import dev.researchhub.source.domain.StorageKey;
import dev.researchhub.support.ApiBrowser;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.*;
import org.springframework.boot.test.context.*;
import org.springframework.context.annotation.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.*;
import tools.jackson.databind.*;
import java.nio.file.*;
import java.time.Instant;
import java.nio.charset.StandardCharsets;
import java.io.ByteArrayInputStream;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT)
@ActiveProfiles("local")
@TestPropertySource(properties={"researchhub.sources.storage.adapter=in-memory","researchhub.processing.dispatcher.enabled=false","researchhub.analysis.execution.dispatcher.enabled=false"})
@Import({PostgresTestcontainersConfiguration.class,AnalysisApiIntegrationTest.Configuration.class})
class AnalysisApiIntegrationTest {
    @TestConfiguration(proxyBeanMethods=false) static class Configuration {
        @Bean SourceStorage storage() { return new InMemorySourceStorage(); }
        @Bean @Primary TestPlanner testPlanner(ObjectMapper json) { return new TestPlanner(json); }
        @Bean @Primary TestRunner testRunner() { return new TestRunner(); }
    }
    static class TestPlanner implements AnalysisPlanner {
        final ObjectMapper json; int calls; int invalidRemaining; boolean fail,chart; Runnable duringCall;
        TestPlanner(ObjectMapper json) { this.json=json; }
        public Candidate plan(PlanningRequest request) {
            calls++; if (duringCall!=null) duringCall.run();
            var input=request.inputs().getFirst(); var version=input.selection().sourceVersionId();
            var ref=new PlanInput(version,"CSV",List.of(1,2));
            var outputs=new ArrayList<Output>(); outputs.add(new Output(OutputKind.TABLE,"result","Selected data",List.of(version)));
            if (chart) outputs.add(new Output(OutputKind.CHART,"plot","Computed chart",List.of(version)));
            var plan=new Plan("1.0","Select columns",List.of(ref),List.of(),List.of(),
                outputs,List.of(),List.of("Code is untrusted"),
                new Code("PYTHON","raise RuntimeError('never executed in application services')"));
            return new Candidate("1.0",request.request().requestId(),new ModelMetadata("deterministic","test-planner","1",true,false),
                new Usage(1,1,2,true),"fixture-"+calls,fail || invalidRemaining-- > 0 ? "{invalid JSON" : json.writeValueAsString(plan));
        }
    }
    static class TestRunner implements SandboxRunner {
        int calls; String failure; Map<String,byte[]> files; Runnable duringRun; Request request;
        public Result run(Request request) {
            this.request=request; calls++; if (duringRun!=null) duringRun.run();
            return new Result(failure==null,failure,failure==null ? 0 : 1,false,"computed stdout","computed stderr",false,false,
                "sha256:"+"a".repeat(64),"1.0.0",files==null ? Map.of("result.json",
                    "{\"schemaVersion\":\"1.0\",\"outputs\":[{\"name\":\"result\",\"kind\":\"TABLE\",\"columns\":[\"mean\"],\"rows\":[[19.5]]}]}".getBytes(StandardCharsets.UTF_8)) : files);
        }
    }
    @Value("${local.server.port}") int port;
    @Autowired ObjectMapper json;
    @Autowired JdbcTemplate jdbc;
    @Autowired TestPlanner planner;
    @Autowired TestRunner runner;
    @Autowired SourceStorage storage;
    @Autowired AnalysisExecutionDispatcher dispatcher;
    @Autowired ExecutionStore executions;
    ApiBrowser owner;
    UUID workspace,ownerId,source,version;
    String path;
    @BeforeEach void prepare() throws Exception {
        jdbc.execute("TRUNCATE users, workspaces CASCADE");
        planner.calls=0; planner.invalidRemaining=0; planner.fail=false; planner.chart=false; planner.duringCall=null;
        runner.calls=0;runner.failure=null;runner.files=null;runner.duringRun=null;runner.request=null;
        ((InMemorySourceStorage)storage).clear();
        owner=new ApiBrowser(port,json); ownerId=UUID.fromString(owner.signUp("owner@example.test","Owner"));
        workspace=UUID.fromString(owner.createdWorkspaceId("Lab","Data")); path="/api/workspaces/"+workspace+"/analyses";
        source=UUID.randomUUID(); version=seed(source,workspace,ownerId);
    }
    UUID seed(UUID id,UUID ws,UUID user) throws Exception {
        byte[] bytes="Frequency,Resistance\n1,10\n2,29\n".getBytes(StandardCharsets.UTF_8);String hash=ExecutionOutputValidator.sha256(bytes);
        storage.store(new StorageKey("sources/"+id),new ByteArrayInputStream(bytes),"text/csv");
        UUID v=SourceRowFixture.insert(jdbc,id,ws,user,"data.csv","data.csv","text/csv","CSV",bytes.length,"sources/"+id,hash,"READY",null,Instant.now());
        UUID job=UUID.randomUUID();
        jdbc.update("INSERT INTO processing_jobs(id,workspace_id,job_type,resource_type,resource_id,status,attempt_count,created_at,started_at,finished_at) VALUES (?,?,'SOURCE_INGEST','SOURCE',?,'SUCCEEDED',1,now(),now(),now())",job,ws,id);
        var body=json.createObjectNode();body.set("workbook",json.readTree(Files.readString(Path.of("../contracts/processing/v4/source-ingest-result-csv.json"))).get("workbook"));
        jdbc.update("INSERT INTO source_version_extractions(source_version_id,source_id,workspace_id,job_id,parser_version,content_sha256,payload,created_at,processing_version,schema_version) VALUES (?,?,?,?,'test',?,?::jsonb,now(),'source-ingest-4','4.0')",v,id,ws,job,hash,json.writeValueAsString(body));
        return v;
    }
    String command(UUID s,UUID v) { return json.writeValueAsString(new Create("Select the first two columns",List.of(new Input(s,v,"CSV",List.of(1,2))))); }
    String create() throws Exception {
        var response=owner.postJson(path,command(source,version)); assertEquals(201,response.statusCode(),response.body());
        assertEquals("no-store",response.headers().firstValue("Cache-Control").orElseThrow());
        var draft=owner.json(response); assertEquals("DRAFT",draft.get("status").asString());assertEquals(ownerId.toString(),draft.get("createdBy").asString());
        assertEquals(workspace.toString(),draft.get("workspaceId").asString()); assertTrue(draft.get("plan").isNull());
        return draft.get("id").asString();
    }
    @Test void createsListsPlansAndPreservesTheCompleteImmutableAudit() throws Exception {
        String id=create();
        assertEquals(1,owner.json(owner.get(path)).size()); assertEquals(0,owner.json(owner.get(path+"?offset=50")).size());
        var response=owner.postJson(path+"/"+id+"/plan","{}"); assertEquals(200,response.statusCode(),response.body());
        var ready=owner.json(response); assertEquals("READY_TO_EXECUTE",ready.get("status").asString());
        assertEquals(version.toString(),ready.get("plan").get("inputs").get(0).get("sourceVersionId").asString());
        assertEquals(ready,owner.json(owner.get(path+"/"+id))); assertEquals(ready,owner.json(owner.postJson(path+"/"+id+"/plan","{}")));
        assertEquals(1,planner.calls); var audit=owner.json(owner.get(path+"/"+id+"/plans")); assertEquals(1,audit.size());
        assertEquals(ownerId.toString(),audit.get(0).get("requestedBy").asString());
        assertEquals(version.toString(),audit.get(0).get("request").get("inputs").get(0).get("preview").get("sourceVersionId").asString());
        assertEquals(ready.get("plan"),audit.get(0).get("plan"));
        assertThrows(org.springframework.dao.DataAccessException.class,() -> jdbc.update("UPDATE analysis_plan_attempts SET payload='{}' WHERE analysis_id=?",UUID.fromString(id)));
        assertThrows(org.springframework.dao.DataAccessException.class,() -> jdbc.update("DELETE FROM analysis_inputs WHERE analysis_id=?",UUID.fromString(id)));
        assertThrows(org.springframework.dao.DataAccessException.class,() -> jdbc.update("UPDATE analyses SET workspace_id=? WHERE id=?",UUID.randomUUID(),UUID.fromString(id)));
        assertThrows(org.springframework.dao.DataAccessException.class,() -> jdbc.update("UPDATE analyses SET status='SUCCEEDED' WHERE id=?",UUID.fromString(id)));
        assertEquals(0,jdbc.queryForObject("SELECT count(*) FROM analyses WHERE status='RUNNING'",Integer.class));
    }
    @Test void boundedRepairPersistsInvalidCandidatesAndExhaustionIsDurable() throws Exception {
        String id=create(); planner.invalidRemaining=1;
        assertEquals(200,owner.postJson(path+"/"+id+"/plan","{}").statusCode());
        var audit=owner.json(owner.get(path+"/"+id+"/plans")); assertEquals(2,audit.size());
        assertEquals("AI_OUTPUT_INVALID",audit.get(0).get("failureCode").asString());assertEquals("{invalid JSON",audit.get(0).get("candidate").get("output").asString());
        assertEquals(1,audit.get(1).get("request").get("repairHints").size());
        String failed=create(); planner.fail=true;int before=planner.calls;
        var error=owner.postJson(path+"/"+failed+"/plan","{}");assertEquals(502,error.statusCode(),error.body());
        assertEquals(3,planner.calls-before);assertEquals("FAILED",owner.json(owner.get(path+"/"+failed)).get("status").asString());
        assertEquals(3,owner.json(owner.get(path+"/"+failed+"/plans")).size());
        assertEquals(409,owner.postJson(path+"/"+failed+"/plan","{}").statusCode());assertEquals(3,planner.calls-before);
    }
    @Test void allReadsAndWritesAreAuthorizedAndForeignWorkspaceVersionsAreHidden() throws Exception {
        String id=create(); var outsider=new ApiBrowser(port,json);var outsiderId=UUID.fromString(outsider.signUp("outsider@example.test","Other"));
        var otherWorkspace=UUID.fromString(outsider.createdWorkspaceId("Other","Data"));var otherSource=UUID.randomUUID();var otherVersion=seed(otherSource,otherWorkspace,outsiderId);
        assertEquals(404,owner.postJson(path,command(otherSource,otherVersion)).statusCode());
        assertEquals(404,owner.postJson(path,json.writeValueAsString(new Create("Compare selected datasets",List.of(
            new Input(source,version,"CSV",List.of(1,2)),new Input(otherSource,otherVersion,"CSV",List.of(1,2)))))).statusCode());
        assertEquals(1,jdbc.queryForObject("SELECT count(*) FROM analyses",Integer.class),"Mixed-workspace inputs cannot create a partial analysis");
        for (var url:List.of(path,path+"/"+id,path+"/"+id+"/plans")) assertEquals(404,outsider.get(url).statusCode());
        assertEquals(404,outsider.postJson(path,command(source,version)).statusCode());assertEquals(404,outsider.postJson(path+"/"+id+"/plan","{}").statusCode());
        assertEquals(404,owner.get("/api/workspaces/"+otherWorkspace+"/analyses/"+id).statusCode());
        assertEquals(201,owner.postJson("/api/workspaces/"+workspace+"/members","{\"email\":\"outsider@example.test\",\"role\":\"VIEWER\"}").statusCode());
        assertEquals(200,outsider.get(path+"/"+id).statusCode());assertEquals(200,outsider.get(path+"/"+id+"/plans").statusCode());
        assertEquals(403,outsider.postJson(path,command(source,version)).statusCode());assertEquals(403,outsider.postJson(path+"/"+id+"/plan","{}").statusCode());
        assertEquals(0,planner.calls);
        assertThrows(org.springframework.dao.DataAccessException.class,() -> jdbc.update("INSERT INTO analysis_inputs(analysis_id,workspace_id,source_id,source_version_id,ordinal) VALUES (?,?,?,?,1)",UUID.fromString(id),workspace,otherSource,otherVersion));
    }
    @Test void invalidRequestsAndCsrfAreRejectedBeforePlanningOrPersistence() throws Exception {
        for (var command:List.of("{}","{\"userPrompt\":\"  \",\"inputs\":[]}",command(source,version).replace("\"columns\":[1,2]","\"columns\":[true]"),command(source,version).replace("CSV","Missing"))) {
            assertEquals(400,owner.postJson(path,command).statusCode(),command);
        }
        assertEquals(403,owner.sendWithoutCsrf("POST",path,command(source,version)).statusCode());
        assertEquals(400,owner.get(path+"?offset=-1").statusCode());assertEquals(404,owner.get(path+"/"+UUID.randomUUID()).statusCode());
        assertEquals(0,jdbc.queryForObject("SELECT count(*) FROM analyses",Integer.class));assertEquals(0,planner.calls);
    }
    @Test void membershipRevocationDuringGenerationCannotApproveAPlan() throws Exception {
        var editor=new ApiBrowser(port,json);var editorId=UUID.fromString(editor.signUp("editor@example.test","Editor"));
        owner.postJson("/api/workspaces/"+workspace+"/members","{\"email\":\"editor@example.test\",\"role\":\"EDITOR\"}");
        String id=create();planner.duringCall=() -> jdbc.update("DELETE FROM workspace_members WHERE workspace_id=? AND user_id=?",workspace,editorId);
        assertEquals(404,editor.postJson(path+"/"+id+"/plan","{}").statusCode());
        var failed=owner.json(owner.get(path+"/"+id));assertEquals("FAILED",failed.get("status").asString());assertTrue(failed.get("plan").isNull());
        assertEquals(1,owner.json(owner.get(path+"/"+id+"/plans")).size());
    }
    @Test void archivedWorkspaceKeepsReadAccessAndRejectsNewRequestsOrPlanning() throws Exception {
        String id=create();assertEquals(200,owner.postJson("/api/workspaces/"+workspace+"/archive","{}").statusCode());
        assertEquals(200,owner.get(path+"/"+id).statusCode());assertEquals(200,owner.get(path+"/"+id+"/plans").statusCode());
        assertEquals(409,owner.postJson(path,command(source,version)).statusCode());
        assertEquals(409,owner.postJson(path+"/"+id+"/plan","{}").statusCode());
        assertEquals(0,planner.calls);
    }
    String ready() throws Exception {
        String id=create();assertEquals(200,owner.postJson(path+"/"+id+"/plan","{}").statusCode());return id;
    }
    String enqueue(String id) throws Exception {
        var queued=owner.postJson(path+"/"+id+"/execute","{}");assertEquals(202,queued.statusCode(),queued.body());
        assertEquals("QUEUED",owner.json(queued).get("status").asString());
        assertTrue(queued.headers().firstValue("Location").orElseThrow().contains("/executions/"));
        return owner.json(queued).get("id").asString();
    }
    @Test void executesImmutableInputsPublishesRuntimeTablesAndRetriesAsAppendOnlyAttempts() throws Exception {
        String draft=create();assertEquals(409,owner.postJson(path+"/"+draft+"/execute","{}").statusCode());
        String id=ready(),execution=enqueue(id);
        assertEquals(409,owner.postJson(path+"/"+id+"/execute","{}").statusCode());assertEquals(0,runner.calls);
        dispatcher.dispatchAvailable();
        var run=owner.json(owner.get(path+"/"+id+"/executions/"+execution));
        assertEquals("SUCCEEDED",run.get("status").asString());assertEquals(19.5,run.get("result").get("outputs").get(0).get("rows").get(0).get(0).asDouble());
        assertEquals("computed stdout",run.get("diagnostics").get("stdout").asString());
        assertEquals("sha256:"+"a".repeat(64),run.get("provenance").get("imageId").asString());
        assertEquals(version.toString(),run.get("provenance").get("inputs").get(0).get("sourceVersionId").asString());
        assertEquals(ExecutionOutputValidator.sha256(runner.request.inputs().getFirst().bytes()),run.get("provenance").get("inputs").get(0).get("sha256").asString());
        assertEquals("SUCCEEDED",owner.json(owner.get(path+"/"+id)).get("status").asString());
        assertThrows(org.springframework.dao.DataAccessException.class,() -> jdbc.update("UPDATE analysis_executions SET payload='{}' WHERE id=?",UUID.fromString(execution)));
        assertThrows(org.springframework.dao.DataAccessException.class,() -> jdbc.update("DELETE FROM analysis_executions WHERE id=?",UUID.fromString(execution)));
        String retry=enqueue(id);assertNotEquals(execution,retry);dispatcher.dispatchAvailable();
        assertEquals(run,owner.json(owner.get(path+"/"+id+"/executions/"+execution)));
        var history=owner.json(owner.get(path+"/"+id+"/executions"));assertEquals(2,history.size());assertEquals(2,history.get(1).get("attempt").asInt());
        assertEquals(version,jdbc.queryForObject("SELECT active_version_id FROM sources WHERE id=?",UUID.class,source));
        assertEquals("READY",jdbc.queryForObject("SELECT status FROM source_versions WHERE id=?",String.class,version));
        assertEquals(404,owner.get(path+"/"+id+"/executions/"+UUID.randomUUID()).statusCode());
    }
    @Test void chartArtifactsAreExactAuthenticatedAttachmentsAndCannotBeOverwritten() throws Exception {
        planner.chart=true;String id=ready(),execution=enqueue(id);
        byte[] png={(byte)137,80,78,71,13,10,26,10,1};
        runner.files=Map.of("result.json","{\"schemaVersion\":\"1.0\",\"outputs\":[{\"name\":\"result\",\"kind\":\"TABLE\",\"columns\":[\"mean\"],\"rows\":[[19.5]]},{\"name\":\"plot\",\"kind\":\"CHART\",\"file\":\"plot.png\"}]}".getBytes(StandardCharsets.UTF_8),"plot.png",png);
        dispatcher.dispatchAvailable();var run=owner.json(owner.get(path+"/"+id+"/executions/"+execution));
        String artifact=run.get("result").get("outputs").get(1).get("artifact").get("id").asString();
        String url=path+"/"+id+"/executions/"+execution+"/artifacts/"+artifact;
        var download=owner.getBytes(url);assertEquals(200,download.statusCode());assertArrayEquals(png,download.body());
        assertEquals("nosniff",download.headers().firstValue("X-Content-Type-Options").orElseThrow());
        assertTrue(download.headers().firstValue("Content-Disposition").orElseThrow().startsWith("attachment"));
        assertTrue(download.headers().firstValue("Content-Security-Policy").orElseThrow().contains("sandbox"));
        assertThrows(org.springframework.dao.DataAccessException.class,() -> jdbc.update("UPDATE analysis_execution_artifacts SET content=? WHERE id=?",png,UUID.fromString(artifact)));
        assertThrows(org.springframework.dao.DataAccessException.class,() -> jdbc.update("DELETE FROM analysis_execution_artifacts WHERE id=?",UUID.fromString(artifact)));
        var outsider=new ApiBrowser(port,json);outsider.signUp("other@example.test","Other");
        assertEquals(404,outsider.get(url).statusCode());assertEquals(404,outsider.get(path+"/"+id+"/executions").statusCode());
        assertEquals(404,owner.get(url.replace(artifact,UUID.randomUUID().toString())).statusCode());
    }
    @Test void queuedAccessRevocationAndCorruptStorageCannotLaunchCodeOrExposeResults() throws Exception {
        var editor=new ApiBrowser(port,json);var editorId=UUID.fromString(editor.signUp("executor@example.test","Executor"));
        owner.postJson("/api/workspaces/"+workspace+"/members","{\"email\":\"executor@example.test\",\"role\":\"EDITOR\"}");
        String id=ready();assertEquals(202,editor.postJson(path+"/"+id+"/execute","{}").statusCode());
        jdbc.update("DELETE FROM workspace_members WHERE workspace_id=? AND user_id=?",workspace,editorId);dispatcher.dispatchAvailable();
        var history=owner.json(owner.get(path+"/"+id+"/executions"));assertEquals("ACCESS_REVOKED",history.get(0).get("failureCode").asString());assertEquals(0,runner.calls);
        assertEquals(404,editor.get(path+"/"+id+"/executions").statusCode());
        String retry=enqueue(id);storage.delete(new StorageKey("sources/"+source));
        storage.store(new StorageKey("sources/"+source),new ByteArrayInputStream("changed".getBytes(StandardCharsets.UTF_8)),"text/csv");
        dispatcher.dispatchAvailable();var failed=owner.json(owner.get(path+"/"+id+"/executions/"+retry));
        assertEquals("INPUT_CHANGED",failed.get("failureCode").asString());assertTrue(failed.get("result").isNull());assertEquals(0,runner.calls);
        assertEquals(403,owner.sendWithoutCsrf("POST",path+"/"+id+"/execute","{}").statusCode());
    }
    @Test void sandboxFailureInvalidOutputAndRevocationDuringRunAreDurableAndSanitized() throws Exception {
        String id=ready(),first=enqueue(id);runner.failure="EXECUTION_TIMEOUT";dispatcher.dispatchAvailable();
        assertEquals("EXECUTION_TIMEOUT",owner.json(owner.get(path+"/"+id+"/executions/"+first)).get("failureCode").asString());
        String second=enqueue(id);runner.failure=null;runner.files=Map.of("result.json","{\"schemaVersion\":\"1.0\",\"outputs\":[{\"name\":\"model-narrative\",\"kind\":\"TEXT\",\"text\":\"42\"}]}".getBytes(StandardCharsets.UTF_8));
        dispatcher.dispatchAvailable();var invalid=owner.json(owner.get(path+"/"+id+"/executions/"+second));
        assertEquals("EXECUTION_OUTPUT_INVALID",invalid.get("failureCode").asString());assertTrue(invalid.get("result").isNull());
        String third=enqueue(id);runner.files=null;runner.duringRun=() -> jdbc.update("UPDATE workspaces SET archived_at=now(),archived_by=? WHERE id=?",ownerId,workspace);
        dispatcher.dispatchAvailable();assertEquals("ACCESS_REVOKED",owner.json(owner.get(path+"/"+id+"/executions/"+third)).get("failureCode").asString());
        assertEquals(409,owner.postJson(path+"/"+id+"/execute","{}").statusCode());
    }
    @Test void durableClaimsRunOnlyOnceAndInterruptedAttemptsNeedExplicitRetry() throws Exception {
        String id=ready();String execution=enqueue(id);
        var claim=executions.claim(Instant.now()).orElseThrow();assertTrue(executions.claim(Instant.now()).isEmpty());
        executions.recoverInterrupted(claim.startedAt().plusSeconds(1),claim.startedAt().plusSeconds(2));
        var failed=owner.json(owner.get(path+"/"+id+"/executions/"+execution));
        assertEquals("EXECUTION_INTERRUPTED",failed.get("failureCode").asString());assertEquals("FAILED",failed.get("status").asString());
        executions.complete(claim,claim.provenance(),null,ExecutionContracts.Failure.EXECUTION_FAILED,null,claim.startedAt().plusSeconds(3));
        assertEquals(failed,owner.json(owner.get(path+"/"+id+"/executions/"+execution)));assertEquals(0,runner.calls);
    }
}
