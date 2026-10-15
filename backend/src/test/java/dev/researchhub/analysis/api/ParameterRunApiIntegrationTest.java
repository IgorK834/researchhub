package dev.researchhub.analysis.api;

import dev.researchhub.analysis.application.*;
import dev.researchhub.analysis.application.ProblemContracts.*;
import dev.researchhub.shared.infrastructure.persistence.PostgresTestcontainersConfiguration;
import dev.researchhub.support.ApiBrowser;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.*;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.*;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import tools.jackson.databind.*;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

/** Real HTTP -> approved persisted AST -> durable queue -> two isolated pinned runtime phases. No model/worker. */
@EnabledIfEnvironmentVariable(named="ANALYSIS_SANDBOX_TESTS",matches="true")
@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT,properties={"researchhub.analysis.sandbox.enabled=true","researchhub.analysis.execution.dispatcher.enabled=false","researchhub.notifications.dispatcher.enabled=false","researchhub.processing.dispatcher.enabled=false"})
@ActiveProfiles("local") @Import(PostgresTestcontainersConfiguration.class)
class ParameterRunApiIntegrationTest {
    @DynamicPropertySource static void docker(DynamicPropertyRegistry registry){registry.add("researchhub.analysis.sandbox.socket-path",()->System.getenv().getOrDefault("ANALYSIS_SANDBOX_SOCKET_PATH","/var/run/docker.sock"));}
    @Value("${local.server.port}") int port;@Autowired ObjectMapper json;@Autowired JdbcTemplate jdbc;@Autowired ProblemStore store;@Autowired ProblemService problems;
    @MockitoBean ProblemPlanner planner;@MockitoBean AnalysisPlanner datasetPlanner;
    ApiBrowser owner,outsider;UUID workspace,parent;String path;Analysis original;
    @BeforeEach void setup() throws Exception {
        jdbc.execute("TRUNCATE users,workspaces CASCADE");owner=new ApiBrowser(port,json);outsider=new ApiBrowser(port,json);owner.signUp("parameter@test.invalid","Owner");outsider.signUp("parameter-other@test.invalid","Other");workspace=UUID.fromString(owner.createdWorkspaceId("Parameter lab","Frozen inputs"));
        var response=owner.postJson("/api/workspaces/"+workspace+"/analyses",Files.readString(Path.of("../contracts/analysis/computation-plan/v2/problem-create.json")));assertEquals(201,response.statusCode(),response.body());
        parent=UUID.fromString(owner.json(response).path("id").asString());original=store.find(workspace,parent).orElseThrow();
        assertTrue(store.beginPlan(workspace,parent));
        var p=original.snapshot().problem();var approved=new Plan("2.0","PROBLEM",original.snapshot().inputHash(),"Previously approved speed calculation",p.expectedOutputs(),p.assumptions(),List.of(),List.of());
        original=new Analysis(original.schemaVersion(),original.workload(),original.id(),workspace,original.createdBy(),original.userPrompt(),"READY_TO_EXECUTE",original.snapshot(),approved,null,List.of(),null,original.createdAt());store.planned(original);path="/api/workspaces/"+workspace+"/analyses/"+parent;
    }
    @AfterEach void clean(){verifyNoInteractions(planner,datasetPlanner);jdbc.execute("TRUNCATE users,workspaces CASCADE");}
    JsonNode command(UUID key,String distance){return json.valueToTree(Map.of("idempotencyKey",key,"inputMode","ORIGINAL","parameters",Map.of("distance",Map.of("type","DECIMAL","value",distance,"unit","cm"),"time",Map.of("type","DECIMAL","value","2","unit","s"))));}
    JsonNode run(UUID key,String distance) throws Exception {var response=owner.postJson(path+"/runs",json.writeValueAsString(command(key,distance)));assertEquals(202,response.statusCode(),response.body());return owner.json(response);}
    @Test void concurrentRetryCreatesOneLinkedResultWithFrozenProvenanceAndOriginalReproduction() throws Exception {
        var originalRun=owner.json(owner.postJson(path+"/execute","{}"));problems.dispatch();
        String originalRecord=owner.get(path+"/executions/"+originalRun.path("id").asString()+"/record").body();
        assertEquals("SUCCEEDED",json.readTree(originalRecord).path("execution").path("status").asString(),originalRecord);
        String snapshot=ProblemJson.canonical(json,store.find(workspace,parent).orElseThrow());UUID key=UUID.randomUUID();
        JsonNode first,second;try(var pool=Executors.newFixedThreadPool(2)){var a=pool.submit(()->run(key,"200"));var b=pool.submit(()->run(key,"200"));first=a.get();second=b.get();}
        assertEquals(first,second);assertEquals(0,first.path("llmTokens").asInt());assertNotEquals(parent.toString(),first.path("analysisId").asString());
        assertEquals(1,jdbc.queryForObject("SELECT count(*) FROM analysis_parameter_runs",Integer.class));assertEquals(2,jdbc.queryForObject("SELECT count(*) FROM problem_executions",Integer.class));
        problems.dispatch();String childPath="/api/workspaces/"+workspace+"/analyses/"+first.path("analysisId").asString();
        var child=owner.json(owner.get(childPath));assertEquals(parent.toString(),child.path("parentAnalysisId").asString());assertNotEquals(original.snapshot().inputHash(),child.path("snapshot").path("inputHash").asString());
        var completed=owner.json(owner.get(childPath+"/executions/"+first.path("executionId").asString()));assertEquals("SUCCEEDED",completed.path("status").asString(),completed.toString());assertEquals(1.0,completed.path("result").path("outputs").get(0).path("values").get(0).asDouble());
        var old=json.readTree(originalRecord).path("execution");assertEquals(0.5,old.path("result").path("outputs").get(0).path("values").get(0).asDouble());assertEquals(old.path("solution").path("codeHashes"),completed.path("solution").path("codeHashes"));
        assertEquals(snapshot,ProblemJson.canonical(json,store.find(workspace,parent).orElseThrow()));assertEquals(json.readTree(originalRecord),owner.json(owner.get(path+"/executions/"+originalRun.path("id").asString()+"/record")));
        assertEquals(first,run(key,"200"));assertEquals(409,owner.postJson(path+"/runs",command(key,"300").toString()).statusCode());
        var reproduced=owner.postJson(path+"/problem/executions/"+originalRun.path("id").asString()+"/reproduce","{}");assertEquals(202,reproduced.statusCode(),reproduced.body());problems.dispatch();
        var reproduction=owner.json(owner.get(path+"/executions/"+owner.json(reproduced).path("id").asString()));assertEquals(old.path("result"),reproduction.path("result"));assertEquals(old.path("imageId"),reproduction.path("imageId"));
        assertEquals(0,jdbc.queryForObject("SELECT count(*) FROM analysis_plan_attempts",Integer.class));assertEquals(0,jdbc.queryForObject("SELECT count(*) FROM ai_usage_events",Integer.class));
    }
    @Test void rejectsTypesUnitsBoundsCodeAndForeignRequestsBeforeQueueing() throws Exception {
        for(String value:List.of("-0","1.0","1e3","1000000000001"))assertEquals(400,owner.postJson(path+"/runs",command(UUID.randomUUID(),value).toString()).statusCode());
        var body=(tools.jackson.databind.node.ObjectNode)command(UUID.randomUUID(),"200");((tools.jackson.databind.node.ObjectNode)body.path("parameters").path("distance")).put("unit","m");assertEquals(400,owner.postJson(path+"/runs",body.toString()).statusCode());
        body=(tools.jackson.databind.node.ObjectNode)command(UUID.randomUUID(),"200");body.put("code","print(1)");assertEquals(400,owner.postJson(path+"/runs",body.toString()).statusCode());
        assertEquals(403,owner.sendWithoutCsrf("POST",path+"/runs",command(UUID.randomUUID(),"200").toString()).statusCode());assertEquals(404,outsider.postJson(path+"/runs",command(UUID.randomUUID(),"200").toString()).statusCode());
        assertEquals(200,owner.get(path+"/parameters").statusCode());assertEquals(404,outsider.get(path+"/parameters").statusCode());assertEquals(0,jdbc.queryForObject("SELECT count(*) FROM problem_executions",Integer.class));
    }
    @Test @EnabledIfEnvironmentVariable(named="ANALYSIS_EVOLUTION_BROWSER_TESTS",matches="true")
    void productionBrowserRunsParametersComparesAndReloadsInBothLocales() throws Exception {
        var queued=owner.postJson(path+"/execute","{}");assertEquals(202,queued.statusCode(),queued.body());problems.dispatch();
        var builder=new ProcessBuilder("node","e2e/analysis-evolution.cjs").directory(Path.of("../frontend").toFile());
        builder.environment().put("E2E_BACKEND_URL","http://127.0.0.1:"+port);builder.environment().put("E2E_WORKSPACE_ID",workspace.toString());builder.environment().put("E2E_ANALYSIS_ID",parent.toString());
        var log=Path.of("target/analysis-evolution-browser.log");var process=builder.redirectErrorStream(true).redirectOutput(log.toFile()).start();
        long deadline=System.nanoTime()+java.time.Duration.ofSeconds(55).toNanos();
        while(process.isAlive()&&System.nanoTime()<deadline){problems.dispatch();Thread.sleep(150);}
        if(process.isAlive()){process.destroyForcibly();fail("Browser deadline exceeded: "+log);}
        assertEquals(0,process.exitValue(),Files.readString(log));
    }

}
