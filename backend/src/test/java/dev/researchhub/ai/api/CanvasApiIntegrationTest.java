package dev.researchhub.ai.api;

import dev.researchhub.ai.application.CanvasContracts.*;
import dev.researchhub.document.application.CanvasTargets.*;
import dev.researchhub.document.application.CanvasDocumentTarget;
import dev.researchhub.shared.infrastructure.persistence.PostgresTestcontainersConfiguration;
import dev.researchhub.support.ApiBrowser;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.*;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.*;
import tools.jackson.databind.ObjectMapper;
import java.net.*;
import java.nio.file.Path;
import java.util.*;
import java.util.concurrent.*;
import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT,properties={
    "researchhub.processing.dispatcher.enabled=false","researchhub.analysis.execution.dispatcher.enabled=false",
    "researchhub.collaboration.enabled=true","researchhub.collaboration.service-token=canvas-integration-key-at-least-32-bytes"})
@ActiveProfiles("local")
@Import(PostgresTestcontainersConfiguration.class)
class CanvasApiIntegrationTest {
    static final int SIDECAR_PORT=freePort(),BROWSER_PORT=freePort(),WORKER_PORT=freePort();
    static final String SERVICE_TOKEN="canvas-integration-key-at-least-32-bytes";
    static int freePort() {try(var socket=new java.net.ServerSocket(0)){return socket.getLocalPort();}catch(Exception e){throw new IllegalStateException(e);}}
    @DynamicPropertySource static void properties(DynamicPropertyRegistry p) {
        p.add("researchhub.collaboration.internal-url",()->"http://127.0.0.1:"+SIDECAR_PORT);
        p.add("researchhub.collaboration.websocket-url",()->"ws://localhost:"+BROWSER_PORT+"/collaboration");
        p.add("researchhub.processing.worker.base-url",()->"http://127.0.0.1:"+WORKER_PORT);
        p.add("researchhub.processing.worker.service-token",()->SERVICE_TOKEN);
    }
    @Value("${local.server.port}") int port;@Autowired ObjectMapper json;@Autowired JdbcTemplate jdbc;
    ApiBrowser owner,viewer,outsider;String workspace,document,route,path,viewerId;Capture request;
    final String block="00000001-0000-4000-8000-000000000001";
    @BeforeEach void setup() throws Exception {
        jdbc.execute("TRUNCATE users,workspaces CASCADE");
        owner=new ApiBrowser(port,json);viewer=new ApiBrowser(port,json);outsider=new ApiBrowser(port,json);
        owner.signUp("owner@canvas.test","Owner");viewerId=viewer.signUp("viewer@canvas.test","Viewer");outsider.signUp("outsider@canvas.test","Outsider");
        workspace=owner.createdWorkspaceId("Canvas","Context");
        assertEquals(201,owner.postJson("/api/workspaces/"+workspace+"/members","{\"email\":\"viewer@canvas.test\",\"role\":\"VIEWER\"}").statusCode());
        var doc=owner.postJson("/api/workspaces/"+workspace+"/documents","""
          {"title":"Canvas","content":{"type":"doc","content":[{"type":"paragraph","attrs":{"blockId":"%s"},"content":[{"type":"text","text":"α: A😀B suffix"}]},{"type":"paragraph","content":[{"type":"text","text":"PRIVATE OUTSIDE CONTEXT"}]}]}}
          """.formatted(block));assertEquals(201,doc.statusCode(),doc.body());
        document=owner.json(doc).path("id").asString();route="/api/workspaces/"+workspace+"/documents/"+document;path=route+"/ai/contexts";
        var target=new Target(Kind.TEXT,new Endpoint(block,List.of(0),3),new Endpoint(block,List.of(0),7),CanvasDocumentTarget.hash("A😀B"));
        request=new Capture("1.0",UUID.randomUUID(),1,null,null,null,null,target);
    }
    String body() {return json.writeValueAsString(request);}
    @Test void durableCaptureReplayScopeCsrfAndRevocation() throws Exception {
        assertEquals(403,owner.sendWithoutCsrf("POST",path,body()).statusCode());
        var result=viewer.postJson(path,body());assertEquals(200,result.statusCode(),result.body());
        var context=viewer.json(result);String id=context.path("contextId").asString();
        assertEquals("A😀B",context.path("snapshot").path("text").asString());assertFalse(result.body().contains("PRIVATE"));
        assertEquals(context,viewer.json(viewer.postJson(path,body())));
        assertEquals(200,viewer.get(path+"/"+id).statusCode());assertEquals(200,viewer.postJson(path+"/"+id+"/resolve","{}").statusCode());
        assertEquals(404,outsider.get(path+"/"+id).statusCode());assertEquals(404,outsider.postJson(path,body()).statusCode());
        assertEquals(404,owner.get(path+"/"+UUID.randomUUID()).statusCode());
        var changed=new Capture("1.0",request.clientRequestId(),2,null,null,null,null,request.target());assertEquals(409,viewer.postJson(path,json.writeValueAsString(changed)).statusCode());
        assertEquals(1,jdbc.queryForObject("SELECT count(*) FROM canvas_contexts",Integer.class));
        assertEquals(204,owner.delete("/api/workspaces/"+workspace+"/members/"+viewerId).statusCode());
        assertEquals(404,viewer.get(path+"/"+id).statusCode());assertEquals(404,viewer.postJson(path+"/"+id+"/resolve","{}").statusCode());
    }
    @Test void identityIsAtomicAndTargetsAreNeverSilentlyRetargeted() throws Exception {
        try(var executor=Executors.newVirtualThreadPerTaskExecutor()) {
            var a=executor.submit(()->owner.postJson(path,body()));var b=executor.submit(()->owner.postJson(path,body()));
            var first=a.get();var second=b.get();assertEquals(200,first.statusCode(),first.body());assertEquals(owner.json(first),owner.json(second));
        }
        var result=owner.json(owner.postJson(path,body()));String id=result.path("contextId").asString();
        jdbc.update("UPDATE documents SET content=jsonb_set(content,'{content,1,content,0,text}','\"unrelated\"'),revision=revision+1 WHERE id=?",UUID.fromString(document));
        assertEquals(200,owner.postJson(path+"/"+id+"/resolve","{}").statusCode());
        jdbc.update("UPDATE documents SET content=jsonb_set(content,'{content,0,content,0,text}','\"α: changed suffix\"'),revision=revision+1 WHERE id=?",UUID.fromString(document));
        assertEquals(409,owner.postJson(path+"/"+id+"/resolve","{}").statusCode());
        assertEquals(200,owner.get(path+"/"+id).statusCode()); // immutable history still readable
        var missing=new Target(Kind.TEXT,new Endpoint(UUID.randomUUID().toString(),List.of(0),3),request.target().end(),request.target().hash());
        request=new Capture("1.0",UUID.randomUUID(),3,null,null,null,null,missing);assertEquals(409,owner.postJson(path,body()).statusCode());
    }
    @Test void foreignDocumentSourceAndOutputAreDeniedAndArchivedHistoryIsReadable() throws Exception {
        var other=outsider.createdWorkspaceId("Other","Other");
        assertEquals(404,owner.postJson("/api/workspaces/"+other+"/documents/"+document+"/ai/contexts",body()).statusCode());
        var captured=owner.json(owner.postJson(path,body()));
        String citation="""
          {"type":"doc","content":[{"type":"paragraph","attrs":{"blockId":"%s"},"content":[{"type":"researchCitation","attrs":{"citation":{"sourceId":"%s"}}}]}]}
          """.formatted(block,UUID.randomUUID());
        jdbc.update("UPDATE documents SET content=?::jsonb WHERE id=?",citation,UUID.fromString(document));
        var target=new Target(Kind.SOURCE,new Endpoint(block,List.of(0),0),new Endpoint(block,List.of(0),1),CanvasDocumentTarget.hash("\uFFFC"));
        request=new Capture("1.0",UUID.randomUUID(),1,null,null,null,null,target);assertEquals(404,owner.postJson(path,body()).statusCode());
        String analysis=UUID.randomUUID().toString(),execution=UUID.randomUUID().toString();
        String atom="""
          {"type":"doc","content":[{"type":"analysisResult","attrs":{"blockId":"%s","reference":{"analysisId":"%s","executionId":"%s","outputId":"foreign"}}}]}
          """.formatted(block,analysis,execution);
        jdbc.update("UPDATE documents SET content=?::jsonb WHERE id=?",atom,UUID.fromString(document));
        target=new Target(Kind.ANALYSIS,new Endpoint(block,List.of(0),0),new Endpoint(block,List.of(0),1),CanvasDocumentTarget.hash(analysis+":"+execution+":foreign"));
        request=new Capture("1.0",UUID.randomUUID(),1,null,null,null,null,target);assertEquals(404,owner.postJson(path,body()).statusCode());
        assertEquals(200,owner.postJson("/api/workspaces/"+workspace+"/archive","{}").statusCode());
        assertEquals(409,owner.postJson(path,body()).statusCode());
        assertEquals(200,owner.get(path+"/"+captured.path("contextId").asString()).statusCode());
    }
    @Test void realBrowserAndCanonicalYjs() throws Exception {
        Assumptions.assumeTrue("true".equals(System.getenv("CANVAS_BROWSER_TESTS")),"Opt-in real Chromium/sidecar test");
        var builder=new ProcessBuilder("node","dist/main.js").directory(Path.of("../collaboration").toFile()).redirectErrorStream(true).redirectOutput(Path.of("target/canvas-sidecar.log").toFile());
        builder.environment().putAll(Map.of("COLLABORATION_PORT",String.valueOf(SIDECAR_PORT),"COLLABORATION_SERVICE_TOKEN","canvas-integration-key-at-least-32-bytes","COLLABORATION_BACKEND_URL","http://localhost:"+port,"COLLABORATION_ALLOWED_ORIGINS","http://localhost:"+BROWSER_PORT));
        var workerBuilder=new ProcessBuilder(".venv/bin/python","-m","researchhub_worker").directory(Path.of("../ai-worker").toFile())
            .redirectErrorStream(true).redirectOutput(Path.of("target/canvas-worker.log").toFile());
        workerBuilder.environment().putAll(Map.of("AI_WORKER_HOST","127.0.0.1","AI_WORKER_PORT",String.valueOf(WORKER_PORT),
            "AI_WORKER_SERVICE_TOKEN",SERVICE_TOKEN,"AI_WORKER_MODEL_PROVIDER","deterministic"));
        var worker=workerBuilder.start();
        Process sidecar=null,run=null;
        try {
            sidecar=builder.start();
            awaitReady(WORKER_PORT);awaitReady(SIDECAR_PORT);
            var browser=new ProcessBuilder("node","e2e/canvas.cjs").directory(Path.of("../frontend").toFile()).redirectErrorStream(true)
                .redirectOutput(Path.of("target/canvas-browser.log").toFile());
            browser.environment().putAll(Map.of("E2E_BACKEND_URL","http://localhost:"+port,"E2E_DOCUMENT_ROUTE",route,"E2E_FRONTEND_PORT",String.valueOf(BROWSER_PORT),
                "E2E_COLLABORATION_URL","http://127.0.0.1:"+SIDECAR_PORT));
            run=browser.start();assertTrue(run.waitFor(120,TimeUnit.SECONDS),"Browser test timed out");assertEquals(0,run.exitValue(),
                ()-> {try{return java.nio.file.Files.readString(Path.of("target/canvas-browser.log"));}catch(Exception error){return "See canvas-browser.log";}});
        } finally {stop(run);stop(sidecar);stop(worker);}
    }
    static void stop(Process process) throws InterruptedException {
        if(process==null)return;process.destroy();if(!process.waitFor(5,TimeUnit.SECONDS))process.destroyForcibly();
    }
    static void awaitReady(int port) throws Exception {
        var client=java.net.http.HttpClient.newBuilder().version(java.net.http.HttpClient.Version.HTTP_1_1).build();
        var request=java.net.http.HttpRequest.newBuilder(URI.create("http://127.0.0.1:"+port+"/health")).timeout(java.time.Duration.ofSeconds(1)).GET().build();
        long deadline=System.nanoTime()+TimeUnit.SECONDS.toNanos(10);
        while(System.nanoTime()<deadline){try{if(client.send(request,java.net.http.HttpResponse.BodyHandlers.discarding()).statusCode()==200)return;}catch(java.io.IOException unavailable){}Thread.sleep(100);}
        fail("Canvas test service did not become healthy on port "+port);
    }
}
