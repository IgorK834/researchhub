package dev.researchhub.ai.api;

import com.sun.net.httpserver.HttpServer;
import dev.researchhub.ai.application.*;
import dev.researchhub.ai.application.SourceAnalysisContracts.*;
import dev.researchhub.ai.application.GenerationContracts.Evidence;
import dev.researchhub.ai.application.GenerationContracts.ModelMetadata;
import dev.researchhub.ai.application.GenerationContracts.Usage;
import dev.researchhub.shared.infrastructure.persistence.PostgresTestcontainersConfiguration;
import dev.researchhub.support.ApiBrowser;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.*;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.*;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import tools.jackson.databind.*;
import java.net.*;
import java.util.*;
import java.util.concurrent.atomic.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;

/** Browser HTTP -> authorized Java retrieval -> internal worker HTTP -> immutable Postgres provenance. */
@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT)
@ActiveProfiles("local")
@TestPropertySource(properties="researchhub.processing.dispatcher.enabled=false")
@Import(PostgresTestcontainersConfiguration.class)
class SourceAnalysisApiIntegrationTest {
    static final ObjectMapper JSON=new ObjectMapper();
    static final AtomicReference<String> MODE=new AtomicReference<>("normal");
    static final AtomicReference<ContextContracts.ContextualRequest> LAST=new AtomicReference<>();
    static final AtomicInteger CALLS=new AtomicInteger();
    static final HttpServer WORKER=worker();
    static HttpServer worker() {
        try {
            var server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
            server.createContext("/internal/ai/analyze",exchange -> {
                CALLS.incrementAndGet(); assertTrue(exchange.getRequestHeaders().getFirst("Authorization").startsWith("Bearer "));
                var contextual=JSON.readValue(exchange.getRequestBody().readAllBytes(),ContextContracts.ContextualRequest.class); LAST.set(contextual);
                var request=contextual.request(); var input=JSON.readTree(request.instruction());
                var selected=new ArrayList<UUID>(); input.path("selectedSourceIds").forEach(n -> selected.add(UUID.fromString(n.asString())));
                var criteria=new ArrayList<String>(); input.path("criteria").forEach(n -> criteria.add(n.asString()));
                var mapping=new HashMap<UUID,List<String>>();
                String[] lines=contextual.context().text().split("\n");
                for (int i=1;i<lines.length;i+=2) {
                    var block=JSON.readTree(lines[i]); mapping.computeIfAbsent(UUID.fromString(block.path("sourceId").asString()),_ -> new ArrayList<>()).add(block.path("chunkId").asString());
                }
                Answer answer;
                if ("COMPARISON".equals(input.path("kind").asString())) {
                    var rows=selected.stream().map(id -> new Row(id,criteria.stream().map(c -> new Cell(c,"method".equals(c) && mapping.containsKey(id) ? "REPORTED" : "MISSING",
                        "method".equals(c) && mapping.containsKey(id) ? "Reported method" : null,"method".equals(c) ? mapping.getOrDefault(id,List.of()) : List.of())).toList())).toList();
                    if ("cross-source".equals(MODE.get())) rows=List.of(new Row(selected.getFirst(),criteria.stream().map(c -> new Cell(c,"REPORTED","Wrong attribution",mapping.get(selected.getLast()))).toList()),rows.getLast());
                    var cited=request.evidence().stream().map(Evidence::chunkId).toList();
                    answer=new Answer("READY",rows,List.of(new Statement("Cited summary", "invent".equals(MODE.get()) ? List.of("f".repeat(64)) : cited)),List.of());
                } else {
                    var left=selected.getFirst(); var right=selected.getLast();
                    // Invalid typed findings are assembled as JSON below rather than silently repaired.
                    var finding=new Finding(Category.POTENTIAL_DISAGREEMENT,"Review different experimental conditions",List.of(new Side(left,"First result",mapping.get(left)),new Side(right,"Second result",mapping.get(right))),new Cell("method","REPORTED","Different contexts",request.evidence().stream().map(Evidence::chunkId).toList()));
                    answer=new Answer("READY",List.of(),List.of(),List.of(finding));
                }
                var result=new Result("1.0",request.requestId(),request.templateId(),request.templateHash(),new ModelMetadata("deterministic","http-fixture","1",true,false),new Usage(20,10,30,true),"fixture",answer);
                var tree=JSON.valueToTree(result);
                if ("same-side".equals(MODE.get())) ((tools.jackson.databind.node.ObjectNode)tree.path("answer").path("findings").get(0).path("sides").get(1)).put("sourceId",selected.getFirst().toString());
                if ("unknown".equals(MODE.get())) ((tools.jackson.databind.node.ObjectNode)tree).put("extra","unsafe");
                byte[] body=JSON.writeValueAsBytes(tree); exchange.sendResponseHeaders(200,body.length); exchange.getResponseBody().write(body); exchange.close();
            }); server.start(); return server;
        } catch (Exception error) { throw new ExceptionInInitializerError(error); }
    }
    @DynamicPropertySource static void workerProperties(DynamicPropertyRegistry registry) { registry.add("researchhub.processing.worker.base-url",() -> "http://127.0.0.1:"+WORKER.getAddress().getPort()); }
    @Value("${local.server.port}") int port;
    @Autowired ObjectMapper json;
    @Autowired JdbcTemplate jdbc;
    @MockitoBean RetrievalSearchService search;
    @MockitoBean SourceRetrievalService retrieval;
    ApiBrowser owner; UUID workspace,caller; List<UUID> sources; List<RetrievalChunk> chunks; String path;
    @BeforeEach void setup() throws Exception {
        jdbc.execute("TRUNCATE users,workspaces CASCADE"); MODE.set("normal");CALLS.set(0);LAST.set(null);
        owner=new ApiBrowser(port,json);owner.signUp("owner@example.com","Owner"); workspace=UUID.fromString(owner.createdWorkspaceId("Research","Sources"));
        caller=jdbc.queryForObject("SELECT id FROM users WHERE email='owner@example.com'",UUID.class); path="/api/workspaces/"+workspace+"/ai/source-analyses";
        sources=List.of(UUID.randomUUID(),UUID.randomUUID()); chunks=new ArrayList<>();
        for (int i=0;i<sources.size();i++) {
            var id=sources.get(i);
            jdbc.update("INSERT INTO sources(id,workspace_id,original_filename,display_name,media_type,source_type,size_bytes,storage_key,content_sha256,status,uploaded_by,created_at,updated_at) VALUES (?,?,'paper.txt',?,'text/plain','TXT',20,?,?,'READY',?,now(),now())",id,workspace,"Paper "+i,"sources/"+id,"a".repeat(64),caller);
            var text="Method: "+(i==0 ? "randomized" : "observational");
            var chunk=new RetrievalChunk((i==0 ? "a" : "b").repeat(64),id,workspace,null,0,text,7,7,"Method",RetrievalIdentity.hash(text),"retrieval-1:test",List.of(new SourceSpan("p7",0,text.length())));
            chunks.add(chunk);
            when(search.search(anyString(),eq(workspace),eq(List.of(id)),eq(2),any())).thenReturn(List.of(new RetrievalHit(chunk,1,1,1,new EmbeddingModel("fixture","fixture","1",4))));
            when(retrieval.chunk(eq(workspace),eq(id),any(),eq(chunk.chunkId()),eq(chunk.processingVersion()))).thenReturn(chunk);
        }
    }
    String command(List<UUID> selected) { return json.writeValueAsString(new Compare(selected,null,null)); }
    JsonNode compare() throws Exception { var response=owner.postJson(path+"/comparisons",command(sources)); assertEquals(200,response.statusCode(),response.body());return owner.json(response); }
    @Test void comparisonAndDifferencesSurviveReloadRetainBothSidesAndImmutableProvenance() throws Exception {
        var comparison=compare(); assertEquals(2,comparison.path("answer").path("rows").size());
        assertEquals("MISSING",comparison.path("answer").path("rows").get(0).path("cells").get(1).path("status").asString());
        assertEquals(7,comparison.path("evidence").get(0).path("pageStart").asInt());
        String id=comparison.path("id").asString(); var read=owner.get(path+"/"+id); assertEquals(200,read.statusCode()); assertEquals(comparison,owner.json(read));
        assertEquals(2,LAST.get().request().evidence().size()); assertEquals("source-comparison:1",LAST.get().request().templateId());
        var response=owner.postJson(path+"/"+id+"/disagreements","{\"instruction\":\"Assess methodology\"}"); assertEquals(200,response.statusCode(),response.body());
        var differences=owner.json(response); assertEquals(id,differences.path("parentComparisonId").asString());
        assertEquals("source-disagreements:1",differences.path("generation").path("templateId").asString());
        assertTrue(differences.path("warnings").toString().contains("AI-assisted"));
        assertEquals(2,differences.path("answer").path("findings").get(0).path("sides").size());
        assertEquals("REPORTED",differences.path("answer").path("findings").get(0).path("methodologicalContext").path("status").asString());
        assertEquals(differences,owner.json(owner.get(path+"/"+differences.path("id").asString())));
        assertEquals(2,jdbc.queryForObject("SELECT count(*) FROM ai_source_analyses",Integer.class));
        assertThrows(org.springframework.dao.DataAccessException.class,() -> jdbc.update("UPDATE ai_source_analyses SET kind='COMPARISON' WHERE id=?",UUID.fromString(id)));
        assertEquals(400,owner.postJson(path+"/"+differences.path("id").asString()+"/disagreements","{}").statusCode());
    }
    @Test void twoThroughFiveExplicitSourcesReturnCompleteTableAndNarrative() throws Exception {
        var all=new ArrayList<>(sources);
        for (int i=2;i<5;i++) {
            var id=UUID.randomUUID();all.add(id);
            jdbc.update("INSERT INTO sources(id,workspace_id,original_filename,display_name,media_type,source_type,size_bytes,storage_key,content_sha256,status,uploaded_by,created_at,updated_at) VALUES (?,?,'paper.txt',?,'text/plain','TXT',20,?,?,'READY',?,now(),now())",id,workspace,"Paper "+i,"sources/"+id,"a".repeat(64),caller);
            var text="Method: cohort "+i;
            var chunk=new RetrievalChunk((char)('a'+i)+""+"c".repeat(63),id,workspace,null,0,text,7,7,"Method",RetrievalIdentity.hash(text),"retrieval-1:test",List.of(new SourceSpan("p7",0,text.length())));
            when(search.search(anyString(),eq(workspace),eq(List.of(id)),eq(2),any())).thenReturn(List.of(new RetrievalHit(chunk,1,1,1,new EmbeddingModel("fixture","fixture","1",4))));
            when(retrieval.chunk(eq(workspace),eq(id),any(),eq(chunk.chunkId()),eq(chunk.processingVersion()))).thenReturn(chunk);
        }
        for (int count=2;count<=5;count++) {
            var response=owner.postJson(path+"/comparisons",command(all.subList(0,count))); assertEquals(200,response.statusCode(),response.body());
            var result=owner.json(response); assertEquals(count,result.path("sources").size());assertEquals(count,result.path("answer").path("rows").size());
            for (var row:result.path("answer").path("rows")) assertEquals(5,row.path("cells").size());
            assertFalse(result.path("answer").path("summary").isEmpty());
        }
    }
    @Test void sourceAndWorkspaceAuthorizationPrecedeSearchAndSavedReadsStayScoped() throws Exception {
        var outsider=new ApiBrowser(port,json);outsider.signUp("outsider@example.com","Outsider");
        assertEquals(404,outsider.postJson(path+"/comparisons",command(sources)).statusCode()); assertEquals(0,CALLS.get()); verifyNoInteractions(search);
        var other=UUID.fromString(outsider.createdWorkspaceId("Other","Other"));
        assertEquals(404,owner.postJson(path+"/comparisons",command(List.of(sources.getFirst(),UUID.randomUUID()))).statusCode()); verifyNoInteractions(search);
        var comparison=compare();String id=comparison.path("id").asString();
        assertEquals(404,outsider.get(path+"/"+id).statusCode());
        assertEquals(404,outsider.get("/api/workspaces/"+other+"/ai/source-analyses/"+id).statusCode());
        assertEquals(201,owner.postJson("/api/workspaces/"+workspace+"/members","{\"email\":\"outsider@example.com\",\"role\":\"VIEWER\"}").statusCode());
        assertEquals(200,outsider.postJson(path+"/comparisons",command(sources)).statusCode());
        jdbc.update("DELETE FROM sources WHERE id=?",sources.getLast());
        assertEquals(404,owner.get(path+"/"+id).statusCode());
    }
    @Test void validatesBoundsAndRejectsInventedCrossSourceAndUnknownOutput() throws Exception {
        for (var ids:List.of(List.of(sources.getFirst()),List.of(sources.getFirst(),sources.getFirst()),Collections.nCopies(6,sources.getFirst())))
            assertEquals(400,owner.postJson(path+"/comparisons", "{\"selectedSourceIds\":"+json.writeValueAsString(ids)+",\"criteria\":null,\"instruction\":null}").statusCode());
        assertEquals(400,owner.postJson(path+"/comparisons", "{\"selectedSourceIds\":"+json.writeValueAsString(sources)+",\"criteria\":[\"method\",\"METHOD\"],\"instruction\":null}").statusCode());
        for (String mode:List.of("invent","cross-source","unknown")) { MODE.set(mode); var response=owner.postJson(path+"/comparisons",command(sources));assertEquals(502,response.statusCode(),response.body());assertTrue(response.body().contains("AI_OUTPUT_INVALID")); }
        MODE.set("normal");var comparison=compare();MODE.set("same-side");assertEquals(502,owner.postJson(path+"/"+comparison.path("id").asString()+"/disagreements","{}").statusCode());
        assertEquals(1,jdbc.queryForObject("SELECT count(*) FROM ai_source_analyses",Integer.class));
    }
    @Test void missingOrSingleSourceEvidenceNeverInventsFieldsOrDifferences() throws Exception {
        when(search.search(anyString(),eq(workspace),anyList(),eq(2),any())).thenReturn(List.of());
        var comparison=compare(); assertTrue(comparison.path("generation").isNull()); assertEquals("INSUFFICIENT_EVIDENCE",comparison.path("answer").path("status").asString());
        assertEquals(0,CALLS.get());
        var response=owner.postJson(path+"/"+comparison.path("id").asString()+"/disagreements","{}");assertEquals(200,response.statusCode(),response.body());assertEquals("INSUFFICIENT_EVIDENCE",owner.json(response).path("answer").path("status").asString());
        assertEquals(0,CALLS.get());
        when(search.search(anyString(),eq(workspace),eq(List.of(sources.getFirst())),eq(2),any())).thenReturn(List.of(new RetrievalHit(chunks.getFirst(),1,1,1,new EmbeddingModel("fixture","fixture","1",4))));
        comparison=compare();response=owner.postJson(path+"/"+comparison.path("id").asString()+"/disagreements","{}");assertEquals(200,response.statusCode());assertEquals("INSUFFICIENT_EVIDENCE",owner.json(response).path("answer").path("status").asString());assertEquals(1,CALLS.get());
    }
    @Test void untrustedRetrievalAndReprocessedEvidenceCannotPublishResults() throws Exception {
        var c=chunks.getFirst(); var foreign=new RetrievalChunk(c.chunkId(),sources.getLast(),workspace,null,0,c.content(),7,7,null,c.contentHash(),c.processingVersion(),c.spans());
        when(search.search(anyString(),eq(workspace),eq(List.of(sources.getFirst())),eq(2),any())).thenReturn(List.of(new RetrievalHit(foreign,1,1,1,new EmbeddingModel("fixture","fixture","1",4))));
        assertEquals(502,owner.postJson(path+"/comparisons",command(sources)).statusCode());assertEquals(0,CALLS.get());
        when(search.search(anyString(),eq(workspace),eq(List.of(sources.getFirst())),eq(2),any())).thenReturn(List.of(new RetrievalHit(c,1,1,1,new EmbeddingModel("fixture","fixture","1",4))));
        var comparison=compare();
        var changed=new RetrievalChunk(c.chunkId(),c.sourceId(),workspace,null,0,"Changed",7,7,null,RetrievalIdentity.hash("Changed"),c.processingVersion(),c.spans());
        when(retrieval.chunk(eq(workspace),eq(c.sourceId()),any(),eq(c.chunkId()),eq(c.processingVersion()))).thenReturn(changed);
        assertEquals(409,owner.postJson(path+"/"+comparison.path("id").asString()+"/disagreements","{}").statusCode());
        assertEquals(409,owner.postJson(path+"/comparisons",command(sources)).statusCode());
        assertEquals(1,jdbc.queryForObject("SELECT count(*) FROM ai_source_analyses",Integer.class));
    }
}
