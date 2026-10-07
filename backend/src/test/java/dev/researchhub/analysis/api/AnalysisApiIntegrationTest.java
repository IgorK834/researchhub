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
        @Bean @Primary TestQuestionModel questionModel() { return new TestQuestionModel(); }
    }
    static class TestQuestionModel implements dev.researchhub.ai.application.ModelProvider {
        dev.researchhub.ai.application.ContextContracts.ContextualRequest last;int calls;boolean invented;
        public ModelMetadata modelMetadata() { return new ModelMetadata("deterministic","mixed-evidence-test","1",true,false); }
        public Result generateStructured(Request request) { throw new AssertionError("Grounded context is required"); }
        public Result generateStructured(dev.researchhub.ai.application.ContextContracts.ContextualRequest contextual) {
            last=contextual;calls++;var request=contextual.request();
            return new Result("1.0",request.requestId(),request.templateId(),request.templateHash(),modelMetadata(),new Usage(1,1,2,true),"test-question",
                new Answer("SUPPORTED",List.of(new Claim("The saved mean is 19.5.",List.of(invented ? "f".repeat(64) : request.evidence().getLast().chunkId())))));
        }
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
    @Autowired dev.researchhub.security.application.CostQuotaStore costlyRequests;
    @Autowired TestPlanner planner;
    @Autowired TestRunner runner;
    @Autowired SourceStorage storage;
    @Autowired AnalysisExecutionDispatcher dispatcher;
    @Autowired ExecutionStore executions;
    @Autowired org.flywaydb.core.Flyway flyway;
    @Autowired TestQuestionModel questionModel;
    ApiBrowser owner;
    UUID workspace,ownerId,source,version;
    String path;
    @BeforeEach void prepare() throws Exception {
        jdbc.execute("TRUNCATE users, workspaces CASCADE");
        planner.calls=0; planner.invalidRemaining=0; planner.fail=false; planner.chart=false; planner.duringCall=null;
        runner.calls=0;runner.failure=null;runner.files=null;runner.duringRun=null;runner.request=null;
        questionModel.calls=0;questionModel.last=null;questionModel.invented=false;
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
    @Test void excessiveAnalysisRequestsCannotEnqueueWorkOrCallThePlanner() throws Exception {
        var policy = new dev.researchhub.security.application.QuotaPolicy(10,30,java.time.Duration.ofMinutes(1));
        for (int i=0;i<9;i++) costlyRequests.admit(ownerId,workspace,dev.researchhub.security.application.CostCategory.ANALYSIS,policy);
        String id=ready();
        assertEquals(1,planner.calls);
        var denied=owner.postJson(path+"/"+id+"/execute","{}");
        assertEquals(429,denied.statusCode(),denied.body());
        assertEquals("ANALYSIS",owner.json(denied).get("quotaCategory").asString());
        assertEquals(429,owner.postJson(path+"/"+id+"/plan","{}").statusCode());
        assertEquals(1,planner.calls); assertEquals(0,runner.calls);
        assertEquals(0,jdbc.queryForObject("SELECT count(*) FROM analysis_executions",Integer.class));
        assertEquals(200,owner.get(path+"/"+id+"/executions").statusCode());
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
    String reportContent(String analysis,String execution,String mode,String output,UUID block) {
        return json.writeValueAsString(Map.of("type","doc","content",List.of(Map.of("type","paragraph","content",List.of(Map.of("type","text","text","Experimental report"))),
            Map.of("type","analysisResult","attrs",Map.of("blockId",block,"reference",Map.of("analysisId",analysis,"executionId",execution,"outputId",output,"renderMode",mode),"caption","Saved experimental result")))));
    }
    @Test void reportReferencesSurviveReloadRerunExplicitUpdateAndHistoryRestore() throws Exception {
        String id=ready(),execution=enqueue(id);dispatcher.dispatchAvailable();UUID block=UUID.randomUUID();
        String reports="/api/workspaces/"+workspace+"/documents",content=reportContent(id,execution,"TABLE","result",block);
        var create=owner.postJson(reports,"{\"title\":\"Experiment\",\"content\":"+content+"}");
        assertEquals(201,create.statusCode(),create.body());String doc=owner.json(create).get("id").asString(),docPath=reports+"/"+doc;
        var first=owner.json(owner.get(docPath));assertEquals(json.readTree(content),first.get("content"));
        String originalVersion=owner.json(owner.get(docPath+"/versions")).get(0).get("id").asString();
        var rerun=owner.json(owner.postJson(path+"/"+id+"/executions/"+execution+"/rerun","{\"inputMode\":\"ORIGINAL\"}"));
        String newer=rerun.get("execution").get("id").asString();dispatcher.dispatchAvailable();
        assertNotEquals(execution,newer);
        assertEquals(json.readTree(content),owner.json(owner.get(docPath)).get("content"));
        var invalid=owner.patchJson(docPath,"{\"title\":\"Experiment\",\"revision\":1,\"saveKind\":\"MANUAL\",\"content\":"+reportContent(id,newer,"CHART","result",block)+"}");
        assertEquals(400,invalid.statusCode(),invalid.body());assertEquals(1,owner.json(owner.get(docPath)).get("revision").asInt());
        String updated=reportContent(id,newer,"TABLE","result",block);
        var save=owner.patchJson(docPath,"{\"title\":\"Experiment\",\"revision\":1,\"saveKind\":\"MANUAL\",\"content\":"+updated+"}");
        assertEquals(200,save.statusCode(),save.body());assertEquals(json.readTree(updated),owner.json(owner.get(docPath)).get("content"));
        assertEquals(409,owner.patchJson(docPath,"{\"title\":\"Experiment\",\"revision\":1,\"content\":"+content+"}").statusCode());
        var restore=owner.postJson(docPath+"/versions/"+originalVersion+"/restore","{\"revision\":2}");
        assertEquals(200,restore.statusCode(),restore.body());assertEquals(json.readTree(content),owner.json(restore).get("content"));
        assertEquals(version.toString(),owner.json(owner.get(path+"/"+id+"/executions/"+execution+"/provenance")).get("inputSources").get(0).get("sourceVersionId").asString());
        assertEquals(2,jdbc.queryForObject("SELECT count(*) FROM product_audit_events WHERE event_type='ANALYSIS_EXECUTED'",Integer.class));
        assertEquals(3,jdbc.queryForObject("SELECT count(*) FROM product_audit_events WHERE event_type='ANALYSIS_BLOCK_INSERTED'",Integer.class));
        var origins=owner.json(owner.get(docPath+"/blocks/"+block+"/provenance"));
        assertEquals(3,origins.size()); assertEquals("ANALYSIS_DERIVED",origins.get(0).path("category").asString());
        assertEquals(execution,origins.get(0).path("metadata").path("analysis").path("executionId").asString());
        assertEquals(newer,origins.get(1).path("metadata").path("analysis").path("executionId").asString());
        assertFalse(origins.toString().contains("Saved experimental result"));
        var safeAudit=owner.json(owner.get("/api/workspaces/"+workspace+"/audit-events")).path("events");
        assertFalse(safeAudit.toString().contains("never executed")); assertFalse(safeAudit.toString().contains("Saved experimental result"));
        var other=new ApiBrowser(port,json);other.signUp("outsider@example.test","Other");
        assertEquals(404,other.get(docPath).statusCode());
        owner.postJson("/api/workspaces/"+workspace+"/members","{\"email\":\"outsider@example.test\",\"role\":\"VIEWER\"}");
        assertEquals(200,other.get(docPath).statusCode());assertEquals(403,other.patchJson(docPath,"{\"title\":\"Experiment\",\"revision\":3,\"content\":"+updated+"}").statusCode());
        String foreign=owner.createdWorkspaceId("Different","Scope");
        assertEquals(404,owner.postJson("/api/workspaces/"+foreign+"/documents","{\"title\":\"Wrong workspace\",\"content\":"+content+"}").statusCode());
        assertEquals(403,owner.sendWithoutCsrf("PATCH",docPath,"{\"title\":\"Experiment\",\"revision\":3,\"content\":"+updated+"}").statusCode());
        Files.writeString(Path.of("target/analysis-report-e2e.json"),json.writeValueAsString(owner.json(owner.get(docPath))));
    }
    @Test void computedQuestionsUsePersistedOutputsAuditAndConversationScopeWithoutRunningCode() throws Exception {
        String id=ready(),execution=enqueue(id);dispatcher.dispatchAvailable();int runs=runner.calls;
        String refs=json.writeValueAsString(List.of(new AnalysisEvidenceService.Reference(UUID.fromString(id),UUID.fromString(execution),"result")));
        String question="{\"question\":\"What was the saved experimental mean?\",\"selectedSourceIds\":[],\"selectedAnalysisOutputs\":"+refs+"}";
        String ai="/api/workspaces/"+workspace+"/ai";
        var answered=owner.postJson(ai+"/questions",question);assertEquals(200,answered.statusCode(),answered.body());var response=owner.json(answered);
        assertEquals("SUPPORTED",response.get("status").asString());assertEquals(0,response.get("citations").size());
        assertEquals("A1",response.get("generation").get("context").get("citations").get(0).get("citationKey").asString());
        assertTrue(questionModel.last.context().text().contains("19.5"));assertTrue(questionModel.last.context().text().contains("[A1]"));
        assertFalse(questionModel.last.context().text().contains("raise RuntimeError"));
        assertEquals(version.toString(),response.get("analysisCitations").get(0).get("inputSources").get(0).get("sourceVersionId").asString());
        String request=response.get("generation").get("result").get("requestId").asString();
        assertEquals(response.get("generation"),owner.json(owner.get(ai+"/generations/"+request)));
        assertEquals(1,jdbc.queryForObject("SELECT jsonb_array_length(analysis_evidence) FROM ai_generation_runs WHERE request_id=?",Integer.class,UUID.fromString(request)));
        String conversation=owner.json(owner.postJson(ai+"/conversations","{\"title\":\"Experiment and theory\"}")).get("id").asString();
        String send=question.substring(0,question.length()-1)+",\"clientRequestId\":\""+UUID.randomUUID()+"\"}";
        var completion=owner.postJson(ai+"/conversations/"+conversation+"/messages",send);assertEquals(200,completion.statusCode(),completion.body());
        var history=owner.json(owner.get(ai+"/conversations/"+conversation));String stored=json.writeValueAsString(history);
        assertTrue(stored.contains(execution));assertTrue(stored.contains("selectedAnalysisOutputs"));assertTrue(stored.contains("analysisCitations"));
        int calls=questionModel.calls;assertEquals(200,owner.postJson(ai+"/conversations/"+conversation+"/messages",send).statusCode());assertEquals(calls,questionModel.calls);
        assertEquals(runs,runner.calls,"Questions never enqueue or execute generated code");
        questionModel.invented=true;assertEquals(502,owner.postJson(ai+"/questions",question).statusCode());
        String failedId=ready(),failedExecution=enqueue(failedId);runner.failure="EXECUTION_FAILED";dispatcher.dispatchAvailable();calls=questionModel.calls;
        assertEquals(409,owner.postJson(ai+"/questions",question.replace(id,failedId).replace(execution,failedExecution)).statusCode());
        assertEquals(calls,questionModel.calls);
        Files.writeString(Path.of("target/analysis-question-e2e.json"),json.writeValueAsString(response));
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
        var record=owner.json(owner.get(path+"/"+id+"/executions/"+execution+"/record"));
        assertEquals(id,record.get("charts").get(0).get("sourceAnalysisId").asString());assertFalse(record.get("charts").get(0).get("metadataAvailable").asBoolean());
        assertTrue(record.get("charts").get(0).get("xAxis").isNull());
        assertEquals(version.toString(),record.get("snapshot").get("inputs").get(0).get("sourceVersionId").asString());
        String content=reportContent(id,execution,"CHART","plot",UUID.randomUUID());
        var report=owner.postJson("/api/workspaces/"+workspace+"/documents","{\"title\":\"Chart report\",\"content\":"+content+"}");
        assertEquals(201,report.statusCode(),report.body());
        String docId=owner.json(report).get("id").asString();
        assertEquals(json.readTree(content),owner.json(owner.get("/api/workspaces/"+workspace+"/documents/"+docId)).get("content"));
        assertEquals(404,outsider.get(path+"/"+id+"/executions/"+execution+"/record").statusCode());
        assertEquals(404,owner.get(path+"/"+id+"/executions/"+UUID.randomUUID()+"/record").statusCode());
        assertThrows(org.springframework.dao.DataAccessException.class,() -> jdbc.update("UPDATE analysis_execution_records SET snapshot='{}' WHERE execution_id=?",UUID.fromString(execution)));
        assertThrows(org.springframework.dao.DataAccessException.class,() -> jdbc.update("DELETE FROM analysis_execution_records WHERE execution_id=?",UUID.fromString(execution)));
    }
    @Test void upgradingLegacyCompletedAttemptsBackfillsExactVersionsAndCodeWithoutRerunningOrInventingAxes() throws Exception {
        String id=ready(),execution=enqueue(id);dispatcher.dispatchAvailable();
        var before=owner.json(owner.get(path+"/"+id+"/executions/"+execution));
        // This database belongs only to this Testcontainers application. Recreate its V21 state, retaining real
        // completed evidence, then run the exact production migration against non-empty historical data.
        jdbc.execute("DROP TABLE report_exports");jdbc.execute("DROP FUNCTION preserve_report_export()");
        jdbc.execute("DROP TABLE ai_usage_events,ai_rag_traces");
        jdbc.execute("DROP TABLE analysis_execution_records");jdbc.execute("DROP FUNCTION validate_analysis_execution_record()");
        jdbc.execute("DROP TABLE analysis_origins");
        jdbc.execute("ALTER TABLE ai_generation_runs DROP COLUMN analysis_evidence");jdbc.execute("ALTER TABLE ai_messages DROP COLUMN selected_analysis_outputs");
        jdbc.execute("DROP TABLE collaboration_credentials");jdbc.execute("DROP TABLE collaboration_documents");
        // Remove the dependent review/AI/audit schema too, so this remains a real V21 -> latest upgrade.
        jdbc.execute("DROP TABLE document_content_operations,comment_ai_citation_acceptances,comment_ai_suggestions,product_audit_events");
        jdbc.execute("DROP TABLE comment_audit_events, comment_replies, document_comments");
        jdbc.execute("DROP FUNCTION review_history_is_immutable()");
        jdbc.execute("ALTER TABLE documents DROP CONSTRAINT uq_documents_workspace_id");
        jdbc.execute("ALTER TABLE document_versions DROP CONSTRAINT ck_document_snapshot_actor,DROP CONSTRAINT ck_document_snapshot_name,DROP CONSTRAINT ck_document_snapshot_state,DROP COLUMN name,DROP COLUMN actor_name,DROP COLUMN yjs_state,DROP COLUMN state_sha256,DROP COLUMN collaboration_epoch,DROP COLUMN collaboration_sequence,ALTER COLUMN created_by SET NOT NULL,ADD CONSTRAINT uq_document_versions_document_revision UNIQUE(document_id,revision)");
        jdbc.execute("DROP INDEX ix_document_versions_order");
        jdbc.execute("DROP TRIGGER tg_processing_correlation ON processing_jobs");
        jdbc.execute("DROP TRIGGER tg_execution_correlation ON analysis_executions");
        jdbc.execute("DROP FUNCTION preserve_request_correlation()");
        jdbc.execute("ALTER TABLE processing_jobs DROP COLUMN request_id");
        jdbc.execute("ALTER TABLE analysis_executions DROP COLUMN request_id");
        jdbc.execute("ALTER TABLE sources DROP COLUMN bibliography, DROP COLUMN tags, DROP COLUMN collections");
        jdbc.execute("DROP INDEX ix_sources_workspace_library, ix_sources_workspace_type_status, ix_sources_workspace_uploader");
        jdbc.execute("DROP FUNCTION source_text_list_valid(jsonb, int, int, boolean)");
        jdbc.update("DELETE FROM flyway_schema_history WHERE version IN ('22','23','24','25','26','27','28','29','30','31','32','33','34')");flyway.migrate();
        var response=owner.get(path+"/"+id+"/executions/"+execution+"/record");assertEquals(200,response.statusCode(),response.body());
        var record=owner.json(response);assertEquals(before,record.get("execution"));
        assertEquals("Select the first two columns",record.get("snapshot").get("userPrompt").asString());
        assertEquals("data.csv",record.get("snapshot").get("inputs").get(0).get("originalFilename").asString());
        assertEquals(version.toString(),record.get("snapshot").get("inputs").get(0).get("sourceVersionId").asString());
        assertEquals(2,record.get("snapshot").get("inputs").get(0).get("sheets").get(0).get("columns").size());
        assertEquals(1,runner.calls);assertEquals(1,record.get("execution").get("result").get("outputs").get(0).get("rows").size());
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
    @Test void originalRerunRetainsInputsCodeAndRuntimeAndExposesAnImmutableLogFreeCitationObject() throws Exception {
        String id=ready(),first=enqueue(id);dispatcher.dispatchAvailable();String base=path+"/"+id+"/executions/"+first;
        var before=owner.json(owner.get(base));var citation=owner.json(owner.get(base+"/provenance"));
        assertEquals(first,citation.get("executionId").asString());assertEquals(id,citation.get("analysisId").asString());
        assertEquals(version.toString(),citation.get("inputSources").get(0).get("sourceVersionId").asString());
        assertEquals("Select the first two columns",citation.get("prompt").asString());assertFalse(citation.has("diagnostics"));
        assertFalse(citation.toString().contains("computed stderr"));assertEquals(19.5,citation.get("result").get("outputs").get(0).get("rows").get(0).get(0).asDouble());
        assertTrue(citation.get("executionHash").asString().matches("[a-f0-9]{64}"));
        assertEquals(base+"/code",citation.get("code").get("url").asString());
        var code=owner.json(owner.get(base+"/code"));assertEquals(before.get("provenance").get("codeSha256"),code.get("sha256"));
        assertEquals(before.get("provenance").get("codeSha256").asString(),ExecutionOutputValidator.sha256(code.get("source").asString()));
        assertTrue(citation.get("outputReferences").get(0).get("detailsUrl").asString().endsWith("?execution="+first+"#output-0"));
        var response=owner.postJson(base+"/rerun","{\"inputMode\":\"ORIGINAL\"}");assertEquals(202,response.statusCode(),response.body());
        String next=owner.json(response).get("execution").get("id").asString();assertNotEquals(first,next);dispatcher.dispatchAvailable();
        assertNotNull(runner.request.savedRuntime());assertEquals(before.get("provenance").get("imageId").asString(),runner.request.savedRuntime().imageId());
        assertEquals(before,owner.json(owner.get(base)));assertEquals(citation,owner.json(owner.get(base+"/provenance")));
        var newCitation=owner.json(owner.get(path+"/"+id+"/executions/"+next+"/provenance"));
        assertNotEquals(citation.get("executionHash"),newCitation.get("executionHash"));assertEquals(citation.get("code").get("sha256"),newCitation.get("code").get("sha256"));
        assertEquals("ORIGINAL",newCitation.get("lineage").get("inputMode").asString());
        assertNotEquals(citation.get("executionTimestamp"),newCitation.get("executionTimestamp"));
    }
    UUID replacement(String status) throws Exception {
        byte[] bytes="Frequency,Resistance\n3,30\n".getBytes(StandardCharsets.UTF_8);String hash=ExecutionOutputValidator.sha256(bytes);
        String key="sources/"+UUID.randomUUID();storage.store(new StorageKey(key),new ByteArrayInputStream(bytes),"text/csv");
        UUID next=SourceRowFixture.addVersion(jdbc,source,2,"new-data.csv","text/csv","CSV",bytes.length,key,hash,status,Instant.now());
        jdbc.update("INSERT INTO source_version_extractions(source_version_id,source_id,workspace_id,job_id,parser_version,content_sha256,payload,created_at,processing_version,schema_version) SELECT ?,source_id,workspace_id,job_id,parser_version,?,payload,now(),processing_version,schema_version FROM source_version_extractions WHERE source_version_id=?",next,hash,version);
        return next;
    }
    @Test void latestRerunCreatesDerivedIntentWithChangedVersionAndCannotMutateOriginalEvidence() throws Exception {
        String id=ready(),first=enqueue(id);dispatcher.dispatchAvailable();String base=path+"/"+id+"/executions/"+first;
        var before=owner.json(owner.get(base+"/provenance"));UUID next=replacement("READY");
        var response=owner.postJson(base+"/rerun","{\"inputMode\":\"LATEST\"}");assertEquals(202,response.statusCode(),response.body());
        var body=owner.json(response);String derived=body.get("analysisId").asString(),run=body.get("execution").get("id").asString();
        assertNotEquals(id,derived);assertNotEquals(first,run);assertEquals(2,planner.calls);
        var changes=body.get("lineage").get("versions").get(0);assertEquals(version.toString(),changes.get("originalVersionId").asString());
        assertEquals(next.toString(),changes.get("selectedVersionId").asString());assertEquals(2,changes.get("selectedVersionNumber").asInt());
        var origin=owner.json(owner.get(path+"/"+derived+"/origin")).get("lineage");assertEquals(body.get("lineage"),origin);
        dispatcher.dispatchAvailable();assertEquals(next,runner.request.inputs().getFirst().sourceVersionId());assertNull(runner.request.savedRuntime());
        var citation=owner.json(owner.get(path+"/"+derived+"/executions/"+run+"/provenance"));
        assertEquals(next.toString(),citation.get("inputSources").get(0).get("sourceVersionId").asString());assertEquals(origin,citation.get("lineage"));
        assertEquals(before,owner.json(owner.get(base+"/provenance")));assertNotEquals(before.get("executionHash"),citation.get("executionHash"));
        assertThrows(org.springframework.dao.DataAccessException.class,() -> jdbc.update("DELETE FROM analysis_origins WHERE analysis_id=?",UUID.fromString(derived)));
        assertThrows(org.springframework.dao.DataAccessException.class,() -> jdbc.update("UPDATE analysis_origins SET payload='{}' WHERE analysis_id=?",UUID.fromString(derived)));
    }
    @Test void latestPlanningFailureKeepsDerivedRequestAndOriginAccessibleWithoutHiddenRetries() throws Exception {
        String id=ready(),first=enqueue(id);dispatcher.dispatchAvailable();planner.fail=true;
        var response=owner.postJson(path+"/"+id+"/executions/"+first+"/rerun","{\"inputMode\":\"LATEST\"}");
        assertEquals(202,response.statusCode(),response.body());var body=owner.json(response);assertTrue(body.get("execution").isNull());
        assertEquals("AI_OUTPUT_INVALID",body.get("failureCode").asString());String derived=body.get("analysisId").asString();
        assertEquals("FAILED",owner.json(owner.get(path+"/"+derived)).get("status").asString());
        assertEquals(first,owner.json(owner.get(path+"/"+derived+"/origin")).get("lineage").get("originExecutionId").asString());
        assertEquals(1,runner.calls);assertEquals(0,owner.json(owner.get(path+"/"+derived+"/executions")).size());
    }
    @Test void rerunsRejectUnsafeBodiesActiveExecutionsIncompatibleLatestDataAndUnauthorizedAccess() throws Exception {
        String id=ready(),first=enqueue(id);String base=path+"/"+id+"/executions/"+first;
        for (String body:List.of("{}","{\"inputMode\":\"OTHER\"}","{\"inputMode\":true}","{\"inputMode\":\"ORIGINAL\",\"code\":\"print(99)\"}"))
            assertEquals(400,owner.postJson(base+"/rerun",body).statusCode());
        assertEquals(409,owner.postJson(base+"/rerun","{\"inputMode\":\"ORIGINAL\"}").statusCode());dispatcher.dispatchAvailable();
        var outsider=new ApiBrowser(port,json);outsider.signUp("citation-other@example.test","Other");
        for (String suffix:List.of("/provenance","/code")) assertEquals(404,outsider.get(base+suffix).statusCode());
        assertEquals(404,outsider.postJson(base+"/rerun","{\"inputMode\":\"LATEST\"}").statusCode());
        owner.postJson("/api/workspaces/"+workspace+"/members","{\"email\":\"citation-other@example.test\",\"role\":\"VIEWER\"}");
        assertEquals(200,outsider.get(base+"/provenance").statusCode());assertEquals(200,outsider.get(base+"/code").statusCode());
        assertEquals(403,outsider.postJson(base+"/rerun","{\"inputMode\":\"ORIGINAL\"}").statusCode());
        assertEquals(403,owner.sendWithoutCsrf("POST",base+"/rerun","{\"inputMode\":\"LATEST\"}").statusCode());
        replacement("PROCESSING");assertEquals(409,owner.postJson(base+"/rerun","{\"inputMode\":\"LATEST\"}").statusCode());
        assertEquals(1,jdbc.queryForObject("SELECT count(*) FROM analyses",Integer.class));
    }
}
