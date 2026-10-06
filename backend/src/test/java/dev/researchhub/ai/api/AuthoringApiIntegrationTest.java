package dev.researchhub.ai.api;

import com.sun.net.httpserver.HttpServer;
import dev.researchhub.ai.application.*;
import dev.researchhub.ai.application.AuthoringContracts.*;
import dev.researchhub.ai.application.GenerationContracts.*;
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
import java.net.http.HttpResponse;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;

/** Real authenticated HTTP, internal model HTTP, Flyway/Postgres and approval transactions. */
@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT)
@ActiveProfiles("local")
@TestPropertySource(properties="researchhub.processing.dispatcher.enabled=false")
@Import(PostgresTestcontainersConfiguration.class)
class AuthoringApiIntegrationTest {
    private static final ObjectMapper JSON=new ObjectMapper();
    private static final AtomicReference<ContextContracts.ContextualRequest> LAST=new AtomicReference<>();
    private static final AtomicInteger CALLS=new AtomicInteger();
    private static final AtomicReference<String> MODE=new AtomicReference<>("normal");
    private static final HttpServer WORKER=startWorker();
    private static HttpServer startWorker() {
        try {
            var server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
            server.createContext("/internal/ai/author",exchange -> {
                CALLS.incrementAndGet();
                assertTrue(exchange.getRequestHeaders().getFirst("Authorization").startsWith("Bearer "));
                var request=JSON.readValue(exchange.getRequestBody().readAllBytes(),ContextContracts.ContextualRequest.class); LAST.set(request);
                var input=JSON.readTree(request.request().instruction());
                String kind=input.path("kind").asString();
                var ids=request.request().evidence().stream().map(Evidence::chunkId).toList();
                String status="normal".equals(MODE.get()) ? "READY" : "INSUFFICIENT_EVIDENCE";
                String text="EVIDENCE".equals(kind) || !"READY".equals(status) ? "" : "REWRITE".equals(kind) ? "Clear replacement." : "Generated section.";
                var matches="EVIDENCE".equals(kind) ? ids.stream().map(id -> new Match(id,"weak".equals(MODE.get()) ? Category.insufficient : Category.supporting,0.9,"Direct evidence for this claim")).toList() : List.<Match>of();
                var answer=new AuthoringContracts.Answer(status,text,"EVIDENCE".equals(kind) || !"READY".equals(status) ? List.of() : ids,matches);
                if ("invent".equals(MODE.get())) answer=new AuthoringContracts.Answer("READY","Invented.",List.of("f".repeat(64)),List.of());
                var r=request.request();
                var result=new AuthoringContracts.Result("1.0",r.requestId(),r.templateId(),r.templateHash(),new ModelMetadata("deterministic","http-fixture","1",true,false),new Usage(20,10,30,true),"fixture",answer);
                byte[] body=JSON.writeValueAsBytes(result); exchange.sendResponseHeaders(200,body.length); exchange.getResponseBody().write(body); exchange.close();
            }); server.start(); return server;
        } catch (Exception error) { throw new ExceptionInInitializerError(error); }
    }
    @DynamicPropertySource static void workerProperties(DynamicPropertyRegistry properties) {
        properties.add("researchhub.processing.worker.base-url",() -> "http://127.0.0.1:"+WORKER.getAddress().getPort());
    }
    @Value("${local.server.port}") int port;
    @Autowired ObjectMapper json;
    @Autowired JdbcTemplate jdbc;
    @MockitoBean RetrievalSearchService search;
    @MockitoBean SourceRetrievalService retrieval;
    ApiBrowser owner; UUID workspace,document,source; RetrievalChunk chunk; String docPath,path;
    @BeforeEach void prepare() throws Exception {
        jdbc.execute("TRUNCATE users,workspaces CASCADE");
        MODE.set("normal"); CALLS.set(0); LAST.set(null);
        owner=new ApiBrowser(port,json); owner.signUp("owner@example.com","Owner");
        workspace=UUID.fromString(owner.createdWorkspaceId("Research","Report"));
        docPath="/api/workspaces/"+workspace+"/documents";
        var created=owner.postJson(docPath,"""
            {"title":"Report","content":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Human claim. More text."}]},{"type":"paragraph","content":[{"type":"text","text":"PRIVATE OTHER PARAGRAPH"}]}]}}
            """);
        assertEquals(201,created.statusCode(),created.body()); document=UUID.fromString(owner.json(created).path("id").asString());
        docPath+="/"+document; path=docPath+"/ai/suggestions";
        source=UUID.randomUUID(); UUID userId=jdbc.queryForObject("SELECT id FROM users WHERE email='owner@example.com'",UUID.class);
        dev.researchhub.source.SourceRowFixture.insertReadyText(jdbc,source,workspace,userId,"Lecture");
        chunk=new RetrievalChunk("b".repeat(64),source,workspace,null,0,"Human claim. Evidence.",7,7,"Theory",RetrievalIdentity.hash("Human claim. Evidence."),"retrieval-1:test",List.of(new SourceSpan("page-7",0,22)));
        when(search.search(anyString(),eq(workspace),nullable(List.class),eq(8),any())).thenAnswer(invocation -> {
            List<UUID> selected=invocation.getArgument(2); return selected!=null && selected.isEmpty() ? List.of() : List.of(new RetrievalHit(chunk,1,1,1,new EmbeddingModel("fixture","fixture","1",4)));
        });
        when(retrieval.chunk(eq(workspace),eq(source),any(),eq(chunk.chunkId()),eq(chunk.processingVersion()))).thenReturn(chunk);
    }
    private String command(Kind kind,List<UUID> sources) {
        return json.writeValueAsString(new AuthoringContracts.Command(kind,1,kind==Kind.DRAFT ? 1 : null,kind==Kind.DRAFT ? null : 1,
            kind==Kind.DRAFT ? null : 13,kind==Kind.REWRITE ? Action.CLARIFY : null,"Explain the theory",sources,300,"ACADEMIC",kind==Kind.DRAFT));
    }
    private JsonNode suggest(Kind kind,List<UUID> sources) throws Exception {
        var response=owner.postJson(path,command(kind,sources)); assertEquals(200,response.statusCode(),response.body()); return owner.json(response);
    }
    private String acceptInput(String edited,String citation) { return json.writeValueAsString(new Accept(1,edited,citation)); }
    private HttpResponse<String> accept(JsonNode suggestion,String edited,String citation) throws Exception { return owner.postJson(path+"/"+suggestion.path("id").asString()+"/accept",acceptInput(edited,citation)); }
    private JsonNode document() throws Exception { return owner.json(owner.get(docPath)); }
    @Test void draftingIsGroundedProposalAndRejectNeverChangesDocument() throws Exception {
        var before=document(); var proposal=suggest(Kind.DRAFT,List.of(source));
        assertEquals(source.toString(),proposal.path("citations").get(0).path("sourceId").asString());
        assertEquals(7,proposal.path("citations").get(0).path("pageStart").asInt());
        assertEquals(before,document());
        String id=proposal.path("id").asString();
        assertEquals(200,owner.get(path+"/"+id).statusCode());
        assertEquals(200,owner.postJson(path+"/"+id+"/reject","{}").statusCode());
        assertEquals(200,owner.postJson(path+"/"+id+"/reject","{}").statusCode());
        assertEquals(before,document()); assertEquals(409,accept(proposal,null,null).statusCode());
        assertEquals(0,jdbc.queryForObject("SELECT count(*) FROM ai_authoring_events",Integer.class));
    }
    @Test void structuredCitationMetadataSurvivesAcceptedInsertManualSaveAndReload() throws Exception {
        var proposal=suggest(Kind.EVIDENCE,null);var accepted=accept(proposal,null,chunk.chunkId()); assertEquals(200,accepted.statusCode());
        var saved=document(); var metadata=saved.path("content").path("content").get(0).path("content").get(1).path("attrs").path("citation");
        assertEquals("1.0",metadata.path("schemaVersion").asString()); assertEquals("c:"+chunk.chunkId(),metadata.path("citationId").asString());
        assertEquals(source.toString(),metadata.path("sourceId").asString()); assertTrue(metadata.path("sourceVersionId").isNull());
        assertEquals(7,metadata.path("locator").path("pageStart").asInt());assertEquals("Lecture",metadata.path("label").asString());assertEquals("NUMERIC",metadata.path("displayStyle").asString());
        var request=json.createObjectNode().put("title","Report").put("revision",2).put("saveKind","MANUAL");request.set("content",saved.path("content"));
        assertEquals(200,owner.patchJson(docPath,json.writeValueAsString(request)).statusCode());
        assertEquals(saved.path("content"),document().path("content"));
    }
    @Test void simultaneousAcceptAndRetryInsertExactlyOnceAndPersistProvenance() throws Exception {
        var proposal=suggest(Kind.DRAFT,List.of(source));
        try (var pool=Executors.newFixedThreadPool(2)) {
            var start=new CountDownLatch(1);
            Callable<HttpResponse<String>> write=() -> { start.await(); return accept(proposal,"Human edited draft.",null); };
            var first=pool.submit(write); var second=pool.submit(write); start.countDown();
            var firstResponse=first.get(); var secondResponse=second.get();
            assertEquals(200,firstResponse.statusCode()); assertEquals(200,secondResponse.statusCode());
            assertEquals(2,owner.json(firstResponse).path("document").path("revision").asLong());
            assertEquals(2,owner.json(secondResponse).path("document").path("revision").asLong());
        }
        assertEquals(2,document().path("revision").asLong()); assertEquals(3,document().path("content").path("content").size());
        assertEquals("Human edited draft.",document().path("content").path("content").get(1).path("content").get(0).path("text").asString());
        assertEquals("researchCitation",document().path("content").path("content").get(1).path("content").get(1).path("type").asString());
        assertEquals(1,jdbc.queryForObject("SELECT count(*) FROM ai_authoring_events",Integer.class));
        assertEquals(1,jdbc.queryForObject("SELECT count(*) FROM product_audit_events WHERE event_type='AI_SUGGESTION_ACCEPTED'",Integer.class));
        assertEquals(409,accept(proposal,"Different text",null).statusCode());
        assertEquals(409,owner.postJson(path+"/"+proposal.path("id").asString()+"/reject","{}").statusCode());
        assertEquals(200,accept(proposal,"Human edited draft.",null).statusCode());
        assertEquals(2,jdbc.queryForObject("SELECT count(*) FROM document_versions",Integer.class));
        assertEquals("ACCEPTED",owner.json(owner.get(path+"/"+proposal.path("id").asString())).path("state").asString());
        assertEquals(proposal.path("id").asString(),jdbc.queryForObject("SELECT id::text FROM ai_authoring_events",String.class));
        var acceptedBlock=document().path("content").path("content").get(1).path("attrs").path("blockId").asString();
        var operations=owner.json(owner.get(docPath+"/blocks/"+acceptedBlock+"/provenance"));
        assertEquals("AI_GENERATED",operations.get(0).path("category").asString());
        assertEquals(proposal.path("id"),operations.get(0).path("sourceOperationId"));
        assertEquals(chunk.chunkId(),operations.get(0).path("metadata").path("citations").get(0).path("chunkId").asString());
        assertTrue(operations.get(0).path("metadata").path("editedBeforeAcceptance").asBoolean());
        assertFalse(operations.toString().contains("Human edited draft."));
        assertEquals(1,jdbc.queryForObject("SELECT count(*) FROM document_content_operations WHERE category='AI_GENERATED'",Integer.class));
        assertThrows(org.springframework.dao.DataAccessException.class,() -> jdbc.update("UPDATE ai_authoring_events SET revision=3"));
    }
    @Test void rewriteSendsBoundedFragmentAndIsAnIdentifiableAiEdit() throws Exception {
        var proposal=suggest(Kind.REWRITE,List.of());
        assertEquals("Human claim.",proposal.path("originalText").asString());
        var sent=json.readTree(LAST.get().request().instruction()); assertEquals("Human claim.",sent.path("selectedText").asString());
        assertFalse(LAST.get().request().instruction().contains("PRIVATE OTHER PARAGRAPH")); assertTrue(LAST.get().request().evidence().isEmpty());
        assertEquals(1,document().path("revision").asLong());
        assertEquals(200,accept(proposal,null,null).statusCode());
        assertEquals("Clear replacement.",document().path("content").path("content").get(0).path("content").get(0).path("text").asString());
        String block=document().path("content").path("content").get(0).path("attrs").path("blockId").asString();
        var origins=owner.json(owner.get(docPath+"/blocks/"+block+"/provenance"));
        assertEquals("AI_REWRITTEN",origins.get(0).path("category").asString());
        assertEquals(proposal.path("id"),origins.get(0).path("sourceOperationId"));
        var changed=document().path("content"); ((tools.jackson.databind.node.ObjectNode)changed.path("content").get(0).path("content").get(0)).put("text","A later human edit.");saveContent(changed);
        origins=owner.json(owner.get(docPath+"/blocks/"+block+"/provenance"));
        assertEquals("HUMAN",origins.get(0).path("category").asString());assertTrue(origins.toString().contains("AI_REWRITTEN"));

        assertEquals(1,jdbc.queryForObject("SELECT count(*) FROM ai_authoring_events",Integer.class));
        assertEquals(1,jdbc.queryForObject("SELECT count(*) FROM product_audit_events WHERE event_type='AI_SUGGESTION_ACCEPTED'",Integer.class));
    }
    @Test void evidenceHasLocationRelevanceAndAddsCitationWithoutRewritingClaim() throws Exception {
        var proposal=suggest(Kind.EVIDENCE,null);
        var candidate=proposal.path("candidates").get(0); assertEquals("supporting",candidate.path("category").asString());
        assertEquals(0.9,candidate.path("relevance").asDouble()); assertEquals(7,candidate.path("citation").path("pageStart").asInt());
        assertTrue(candidate.path("snippet").asString().contains("Human claim"));
        assertEquals(400,accept(proposal,"Rewrite this",chunk.chunkId()).statusCode());
        assertEquals(400,accept(proposal,null,"f".repeat(64)).statusCode());
        assertEquals(200,accept(proposal,null,chunk.chunkId()).statusCode());
        var inline=document().path("content").path("content").get(0).path("content");
        assertEquals("Human claim.",inline.get(0).path("text").asString()); assertEquals("researchCitation",inline.get(1).path("type").asString()); assertEquals(" More text.",inline.get(2).path("text").asString());
    }
    @Test void rejectsForeignDocumentsSourcesViewersAndInventedEvidence() throws Exception {
        var foreign=UUID.randomUUID();
        assertEquals(404,owner.postJson(path,command(Kind.DRAFT,List.of(source,foreign))).statusCode()); assertEquals(0,CALLS.get());
        assertEquals(404,owner.postJson(path.replace(document.toString(),foreign.toString()),command(Kind.DRAFT,List.of(source))).statusCode());
        var outsider=new ApiBrowser(port,json); outsider.signUp("outsider@example.com","Outsider");
        assertEquals(404,outsider.postJson(path,command(Kind.REWRITE,List.of())).statusCode());
        assertEquals(201,owner.postJson("/api/workspaces/"+workspace+"/members","{\"email\":\"outsider@example.com\",\"role\":\"VIEWER\"}").statusCode());
        assertEquals(403,outsider.postJson(path,command(Kind.REWRITE,List.of())).statusCode());
        var proposal=suggest(Kind.DRAFT,List.of(source)); assertEquals(403,outsider.postJson(path+"/"+proposal.path("id").asString()+"/accept",acceptInput(null,null)).statusCode());
        MODE.set("invent"); assertEquals(502,owner.postJson(path,command(Kind.DRAFT,List.of(source))).statusCode()); assertEquals(1,document().path("revision").asLong());
    }
    @Test void staleOrInsufficientSuggestionsDoNotMutateAndMalformedInputsFail() throws Exception {
        MODE.set("insufficient"); var insufficient=suggest(Kind.DRAFT,List.of(source)); assertEquals(400,accept(insufficient,null,null).statusCode());
        MODE.set("normal"); var proposal=suggest(Kind.DRAFT,List.of(source));
        assertEquals(400,accept(proposal,null,chunk.chunkId()).statusCode());
        assertEquals(200,owner.patchJson(docPath,"{\"title\":\"Report\",\"content\":{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\"}]},\"revision\":1,\"saveKind\":\"MANUAL\"}").statusCode());
        assertEquals(409,accept(proposal,null,null).statusCode()); assertEquals(409,owner.postJson(path,command(Kind.DRAFT,List.of(source))).statusCode());
        assertEquals(400,owner.postJson(path,"{}").statusCode());
        assertEquals(400,owner.postJson(path,command(Kind.DRAFT,List.of(source)).replace("300","1001")).statusCode());
    }
    @Test void approvalRollsBackDocumentSnapshotAndStateWhenProvenanceCannotBeWritten() throws Exception {
        var proposal=suggest(Kind.DRAFT,List.of(source));
        jdbc.execute("CREATE FUNCTION fail_ai_acceptance_fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test fixture'; END $$");
        jdbc.execute("CREATE TRIGGER fail_ai_acceptance_fixture BEFORE INSERT ON ai_authoring_events FOR EACH ROW EXECUTE FUNCTION fail_ai_acceptance_fixture()");
        try {
            assertEquals(500,accept(proposal,null,null).statusCode());
            assertEquals(1,document().path("revision").asLong());
            assertEquals("PENDING",owner.json(owner.get(path+"/"+proposal.path("id").asString())).path("state").asString());
            assertEquals(1,jdbc.queryForObject("SELECT count(*) FROM document_versions",Integer.class));
            assertEquals(0,jdbc.queryForObject("SELECT count(*) FROM ai_authoring_events",Integer.class));
        } finally { jdbc.execute("DROP TRIGGER fail_ai_acceptance_fixture ON ai_authoring_events"); jdbc.execute("DROP FUNCTION fail_ai_acceptance_fixture()"); }
        assertEquals(200,accept(proposal,null,null).statusCode());
        assertEquals("AI_ACCEPTANCE",jdbc.queryForObject("SELECT reason FROM document_versions WHERE revision=2",String.class));
    }
    @Test void refusesUnscopedRetrievalBeforeCallingModelAndUnscopedSuggestionReads() throws Exception {
        var foreign=new RetrievalChunk(chunk.chunkId(),source,UUID.randomUUID(),null,chunk.chunkIndex(),chunk.content(),7,7,"Theory",chunk.contentHash(),chunk.processingVersion(),chunk.spans());
        when(search.search(anyString(),eq(workspace),nullable(List.class),eq(8),any())).thenReturn(List.of(new RetrievalHit(foreign,1,1,1,new EmbeddingModel("fixture","fixture","1",4))));
        assertEquals(502,owner.postJson(path,command(Kind.DRAFT,List.of(source))).statusCode()); assertEquals(0,CALLS.get());
        assertEquals(404,owner.get(path+"/"+UUID.randomUUID()).statusCode());
    }
    @Test void emptyRetrievalReturnsInsufficientWithoutModelCall() throws Exception {
        when(search.search(anyString(),any(),nullable(List.class),anyInt(),any())).thenReturn(List.of());
        var proposal=suggest(Kind.DRAFT,List.of(source)); assertEquals(0,CALLS.get()); assertTrue(proposal.path("generatedText").asString().isEmpty());
        assertEquals(400,accept(proposal,null,null).statusCode());
        assertEquals(200,owner.postJson(path+"/"+proposal.path("id").asString()+"/reject","{}").statusCode());
    }
    private UUID commentAnchor;
    private String anchoredComment() throws Exception {
        commentAnchor=UUID.randomUUID();
        var content=json.createObjectNode().put("type","doc");
        var text=content.putArray("content").addObject().put("type","paragraph").putArray("content").addObject().put("type","text").put("text","Human claim.");
        text.putArray("marks").addObject().put("type","commentAnchor").putObject("attrs").putArray("ids").add(commentAnchor.toString());
        var input=json.createObjectNode().put("title","Report").put("revision",1).put("saveKind","MANUAL"); input.set("content",content);
        assertEquals(200,owner.patchJson(docPath,json.writeValueAsString(input)).statusCode());
        UUID id=UUID.randomUUID();
        var response=owner.postJson(docPath+"/comments",json.writeValueAsString(Map.of("id",id,"body","Please verify this claim", "anchor",Map.of("strategy","TEXT_MARK_V1","id",commentAnchor,"quote","Historical quote"))));
        assertEquals(201,response.statusCode(),response.body());
        return docPath+"/comments/"+id;
    }
    private JsonNode evidence(String thread, UUID id) throws Exception {
        var response=owner.postJson(thread+"/ai-evidence",json.writeValueAsString(Map.of("id",id)));
        assertEquals(201,response.statusCode(),response.body()); return owner.json(response);
    }
    private void saveContent(JsonNode content) throws Exception {
        var input=json.createObjectNode().put("title","Report").put("revision",document().path("revision").asLong()).put("saveKind","MANUAL"); input.set("content",content);
        var response=owner.patchJson(docPath,json.writeValueAsString(input)); assertEquals(200,response.statusCode(),response.body());
    }
    @Test void aiCommentIsExplicitAttributedGroundedPersistentAndNeverResolvesHumanThread() throws Exception {
        String thread=anchoredComment(); UUID request=UUID.randomUUID();
        assertEquals(0,CALLS.get()); assertTrue(owner.json(owner.get(thread)).path("comment").path("aiSuggestions").isEmpty());
        var comment=evidence(thread,request); var suggestion=comment.path("aiSuggestions").get(0);
        assertEquals("AI_EVIDENCE",suggestion.path("kind").asString()); assertFalse(suggestion.has("authorId"));
        assertEquals("Owner",suggestion.path("requestedByName").asString()); assertEquals("Human claim.",suggestion.path("claim").asString());
        assertEquals("Human claim.",json.readTree(LAST.get().request().instruction()).path("selectedText").asString());
        assertEquals("OPEN",comment.path("status").asString()); assertTrue(comment.path("replies").isEmpty());
        assertEquals(source.toString(),suggestion.path("evidence").path("candidates").get(0).path("citation").path("sourceId").asString());
        assertEquals(suggestion,owner.json(owner.get(thread)).path("comment").path("aiSuggestions").get(0));
        assertEquals(comment,evidence(thread,request)); assertEquals(1,CALLS.get());
        assertEquals(2,document().path("revision").asLong());
        assertEquals(1,jdbc.queryForObject("SELECT count(*) FROM product_audit_events WHERE event_type='AI_EVIDENCE_REQUESTED'",Integer.class));
        assertThrows(org.springframework.dao.DataAccessException.class,() -> jdbc.update("UPDATE comment_ai_suggestions SET payload='{}'"));
        assertThrows(org.springframework.dao.DataAccessException.class,() -> jdbc.update("DELETE FROM comment_ai_suggestions"));
    }
    @Test void manuallyInsertedEvidenceRequiresSavedExactProvenanceAndRecordsAcceptanceOnlyOnce() throws Exception {
        String thread=anchoredComment(); UUID id=UUID.randomUUID(); evidence(thread,id);
        String accept=thread+"/ai-evidence/"+id+"/accept", input=json.writeValueAsString(Map.of("chunkId",chunk.chunkId()));
        assertEquals(409,owner.postJson(accept,input).statusCode());
        assertEquals(400,owner.postJson(accept,"{\"chunkId\":\"invalid\"}").statusCode());
        assertEquals(404,owner.postJson(thread+"/ai-evidence/"+UUID.randomUUID()+"/accept",input).statusCode());
        assertEquals(400,owner.postJson(accept,json.writeValueAsString(Map.of("chunkId","f".repeat(64)))).statusCode());
        var citation=GenerationContracts.Citation.from(chunk,"Lecture");
        var savedContent=new AuthoringDocument(json).addCitation(json.writeValueAsString(document().path("content")),1,13,citation);
        saveContent(json.readTree(savedContent));
        var accepted=owner.postJson(accept,input); assertEquals(200,accepted.statusCode(),accepted.body());
        assertEquals(chunk.chunkId(),owner.json(accepted).path("aiSuggestions").get(0).path("acceptedChunkIds").get(0).asString());
        assertEquals(200,owner.postJson(accept,input).statusCode());
        assertEquals(1,jdbc.queryForObject("SELECT count(*) FROM comment_ai_citation_acceptances",Integer.class));
        assertEquals(1,jdbc.queryForObject("SELECT count(*) FROM product_audit_events WHERE event_type='AI_SUGGESTION_ACCEPTED'",Integer.class));
        assertEquals("OPEN",owner.json(owner.get(thread)).path("comment").path("status").asString());
        assertThrows(org.springframework.dao.DataAccessException.class,() -> jdbc.update("DELETE FROM comment_ai_citation_acceptances"));
        saveContent(json.readTree("{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\"}]}"));
        assertEquals(200,owner.postJson(accept,input).statusCode());
        assertEquals(1,jdbc.queryForObject("SELECT count(*) FROM product_audit_events WHERE event_type='AI_SUGGESTION_ACCEPTED'",Integer.class));
    }
    @Test void commentAiRoutesAuthorizeWorkspaceRoleScopeAndCsrfBeforeInference() throws Exception {
        String thread=anchoredComment(); UUID id=UUID.randomUUID();
        var stranger=new ApiBrowser(port,json); String viewerId=stranger.signUp("ai-viewer@example.com","Viewer");
        String body=json.writeValueAsString(Map.of("id",id));
        assertEquals(404,stranger.postJson(thread+"/ai-evidence",body).statusCode());
        assertEquals(401,new ApiBrowser(port,json).postJson(thread+"/ai-evidence",body).statusCode());
        assertEquals(403,owner.sendWithoutCsrf("POST",thread+"/ai-evidence",body).statusCode());
        assertEquals(201,owner.postJson("/api/workspaces/"+workspace+"/members","{\"email\":\"ai-viewer@example.com\",\"role\":\"VIEWER\"}").statusCode());
        assertEquals(403,stranger.postJson(thread+"/ai-evidence",body).statusCode());
        assertEquals(0,CALLS.get()); evidence(thread,id);
        String accept=thread+"/ai-evidence/"+id+"/accept",input=json.writeValueAsString(Map.of("chunkId",chunk.chunkId()));
        assertEquals(403,stranger.postJson(accept,input).statusCode());
        assertEquals(200,stranger.get(thread).statusCode());
        assertEquals(400,owner.postJson(thread+"/ai-evidence","{}").statusCode());
        assertEquals(404,owner.postJson(thread.replace(document.toString(),UUID.randomUUID().toString())+"/ai-evidence",body).statusCode());
        owner.patchJson("/api/workspaces/"+workspace+"/members/"+viewerId,"{\"role\":\"EDITOR\"}");
        assertEquals(409,stranger.postJson(thread+"/ai-evidence",body).statusCode());
    }
    @Test void missingAndResolvedAnchorsCannotInvokeAiAndEmptyRetrievalIsAnIdentifiedSuggestion() throws Exception {
        String thread=anchoredComment();
        when(search.search(anyString(),eq(workspace),nullable(List.class),eq(8),any())).thenReturn(List.of());
        var empty=evidence(thread,UUID.randomUUID()).path("aiSuggestions").get(0).path("evidence");
        assertTrue(empty.path("candidates").isEmpty()); assertTrue(empty.path("generation").isNull()); assertEquals(0,CALLS.get());
        assertTrue(empty.path("warnings").get(0).asString().contains("Insufficient"));
        assertEquals(200,owner.patchJson(thread,"{\"status\":\"RESOLVED\"}").statusCode());
        assertEquals(409,owner.postJson(thread+"/ai-evidence",json.writeValueAsString(Map.of("id",UUID.randomUUID()))).statusCode());
        assertEquals(200,owner.patchJson(thread,"{\"status\":\"OPEN\"}").statusCode());
        saveContent(json.readTree("{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\"}]}"));
        assertEquals(409,owner.postJson(thread+"/ai-evidence",json.writeValueAsString(Map.of("id",UUID.randomUUID()))).statusCode());
        assertEquals(1,owner.json(owner.get(thread)).path("comment").path("aiSuggestions").size());
    }
    @Test void nearbyEditsDuringInferenceKeepAssociationButChangingTheClaimRejectsPublication() throws Exception {
        String thread=anchoredComment();
        when(search.search(anyString(),eq(workspace),nullable(List.class),eq(8),any())).thenAnswer(invocation -> {
            var content=(tools.jackson.databind.node.ObjectNode)document().path("content");
            ((tools.jackson.databind.node.ArrayNode)content.path("content").get(0).path("content")).insert(0,json.createObjectNode().put("type","text").put("text","Nearby edit. "));
            saveContent(content);
            return List.of(new RetrievalHit(chunk,1,1,1,new EmbeddingModel("fixture","fixture","1",4)));
        });
        evidence(thread,UUID.randomUUID());
        when(search.search(anyString(),eq(workspace),nullable(List.class),eq(8),any())).thenAnswer(invocation -> {
            var content=document().path("content"); ((tools.jackson.databind.node.ObjectNode)content.path("content").get(0).path("content").get(1)).put("text","Changed claim."); saveContent(content);
            return List.of(new RetrievalHit(chunk,1,1,1,new EmbeddingModel("fixture","fixture","1",4)));
        });
        assertEquals(409,owner.postJson(thread+"/ai-evidence",json.writeValueAsString(Map.of("id",UUID.randomUUID()))).statusCode());
        assertEquals(1,jdbc.queryForObject("SELECT count(*) FROM comment_ai_suggestions",Integer.class));
    }
    @Test void resolutionAndRevocationDuringInferenceCannotPublishOrChangeHumanStatus() throws Exception {
        String thread=anchoredComment();
        when(search.search(anyString(),eq(workspace),nullable(List.class),eq(8),any())).thenAnswer(invocation -> {
            assertEquals(200,owner.patchJson(thread,"{\"status\":\"RESOLVED\"}").statusCode());
            return List.of(new RetrievalHit(chunk,1,1,1,new EmbeddingModel("fixture","fixture","1",4)));
        });
        assertEquals(409,owner.postJson(thread+"/ai-evidence",json.writeValueAsString(Map.of("id",UUID.randomUUID()))).statusCode());
        assertEquals("RESOLVED",owner.json(owner.get(thread)).path("comment").path("status").asString());
        assertEquals(0,jdbc.queryForObject("SELECT count(*) FROM comment_ai_suggestions",Integer.class));
        assertEquals(200,owner.patchJson(thread,"{\"status\":\"OPEN\"}").statusCode());
        when(search.search(anyString(),eq(workspace),nullable(List.class),eq(8),any())).thenAnswer(invocation -> {
            jdbc.update("UPDATE workspace_members SET role='VIEWER' WHERE workspace_id=?",workspace);
            return List.of(new RetrievalHit(chunk,1,1,1,new EmbeddingModel("fixture","fixture","1",4)));
        });
        assertEquals(403,owner.postJson(thread+"/ai-evidence",json.writeValueAsString(Map.of("id",UUID.randomUUID()))).statusCode());
        assertEquals(0,jdbc.queryForObject("SELECT count(*) FROM comment_ai_suggestions",Integer.class));
    }
    @Test void commentEvidenceFailsClosedForForeignOrInventedEvidenceAndRollsBackOnAuditFailure() throws Exception {
        String thread=anchoredComment(); MODE.set("invent");
        assertEquals(502,owner.postJson(thread+"/ai-evidence",json.writeValueAsString(Map.of("id",UUID.randomUUID()))).statusCode()); MODE.set("normal");
        jdbc.execute("CREATE FUNCTION fail_product_audit_fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_type='AI_EVIDENCE_REQUESTED' THEN RAISE EXCEPTION 'fixture'; END IF; RETURN NEW; END $$");
        jdbc.execute("CREATE TRIGGER fail_product_audit_fixture BEFORE INSERT ON product_audit_events FOR EACH ROW EXECUTE FUNCTION fail_product_audit_fixture()");
        try {
            assertEquals(500,owner.postJson(thread+"/ai-evidence",json.writeValueAsString(Map.of("id",UUID.randomUUID()))).statusCode());
            assertEquals(0,jdbc.queryForObject("SELECT count(*) FROM comment_ai_suggestions",Integer.class));
        } finally { jdbc.execute("DROP TRIGGER fail_product_audit_fixture ON product_audit_events"); jdbc.execute("DROP FUNCTION fail_product_audit_fixture()"); }
    }

    @Test void commentEvidenceRetrievalFailsClosedAndProviderFailuresNeverPublish() throws Exception {
        String thread=anchoredComment();
        var foreign=new RetrievalChunk(chunk.chunkId(),source,UUID.randomUUID(),null,0,chunk.content(),7,7,"Theory",chunk.contentHash(),chunk.processingVersion(),chunk.spans());
        when(search.search(anyString(),eq(workspace),nullable(List.class),eq(8),any())).thenReturn(List.of(new RetrievalHit(foreign,1,1,1,new EmbeddingModel("fixture","fixture","1",4))));
        assertEquals(502,owner.postJson(thread+"/ai-evidence",json.writeValueAsString(Map.of("id",UUID.randomUUID()))).statusCode()); assertEquals(0,CALLS.get());
        when(search.search(anyString(),eq(workspace),nullable(List.class),eq(8),any())).thenThrow(new EmbeddingFailure(new RuntimeException("secret provider details"),true));
        var unavailable=owner.postJson(thread+"/ai-evidence",json.writeValueAsString(Map.of("id",UUID.randomUUID())));
        assertEquals(503,unavailable.statusCode()); assertFalse(unavailable.body().contains("secret provider"));
        when(search.search(anyString(),eq(workspace),nullable(List.class),eq(8),any())).thenThrow(new EmbeddingFailure(new RuntimeException("secret"),false));
        assertEquals(502,owner.postJson(thread+"/ai-evidence",json.writeValueAsString(Map.of("id",UUID.randomUUID()))).statusCode());
        assertEquals(0,jdbc.queryForObject("SELECT count(*) FROM comment_ai_suggestions",Integer.class));
    }
    @Test void insufficientCandidatesCannotBeAcceptedAndChangedClaimsRequireFreshEvidence() throws Exception {
        String thread=anchoredComment(); MODE.set("weak"); UUID weak=UUID.randomUUID();
        assertTrue(evidence(thread,weak).path("aiSuggestions").get(0).path("evidence").path("warnings").toString().contains("Insufficient"));
        assertEquals(400,owner.postJson(thread+"/ai-evidence/"+weak+"/accept",json.writeValueAsString(Map.of("chunkId",chunk.chunkId()))).statusCode());
        MODE.set("normal"); UUID fresh=UUID.randomUUID(); evidence(thread,fresh);
        var changed=document().path("content"); ((tools.jackson.databind.node.ObjectNode)changed.path("content").get(0).path("content").get(0)).put("text","Changed claim."); saveContent(changed);
        assertEquals(409,owner.postJson(thread+"/ai-evidence/"+fresh+"/accept",json.writeValueAsString(Map.of("chunkId",chunk.chunkId()))).statusCode());
        assertEquals(0,jdbc.queryForObject("SELECT count(*) FROM comment_ai_citation_acceptances",Integer.class));
    }

    @Test void escapedClaimsRespectTheGatewayBudgetWithoutPublishingOrCallingTheModel() throws Exception {
        String thread=anchoredComment();
        var content=document().path("content");
        ((tools.jackson.databind.node.ObjectNode)content.path("content").get(0).path("content").get(0)).put("text","\"".repeat(2000));
        saveContent(content);
        var result=owner.postJson(thread+"/ai-evidence",json.writeValueAsString(Map.of("id",UUID.randomUUID())));
        assertEquals(413,result.statusCode(),result.body());
        assertEquals("AI_CONTEXT_TOO_LARGE",owner.json(result).path("code").asString());
        assertEquals(0,CALLS.get());
        assertEquals(0,jdbc.queryForObject("SELECT count(*) FROM comment_ai_suggestions",Integer.class));
    }

}
