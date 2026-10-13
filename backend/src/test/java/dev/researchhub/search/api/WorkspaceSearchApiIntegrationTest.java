package dev.researchhub.search.api;

import dev.researchhub.shared.infrastructure.persistence.PostgresTestcontainersConfiguration;
import dev.researchhub.source.application.InMemorySourceStorage;
import dev.researchhub.source.application.SourceStorage;
import dev.researchhub.support.ApiBrowser;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.TestPropertySource;
import tools.jackson.databind.ObjectMapper;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.Set;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@ActiveProfiles("local")
@TestPropertySource(properties = {
        "researchhub.sources.storage.adapter=in-memory",
        "researchhub.processing.dispatcher.enabled=false"
})
@Import({PostgresTestcontainersConfiguration.class, WorkspaceSearchApiIntegrationTest.StorageConfiguration.class})
class WorkspaceSearchApiIntegrationTest {
    @TestConfiguration(proxyBeanMethods = false)
    static class StorageConfiguration {
        @Bean SourceStorage sourceStorage() { return new InMemorySourceStorage(); }
    }

    @Value("${local.server.port}") int port;
    @Autowired ObjectMapper json;
    @Autowired JdbcTemplate jdbc;
    @Autowired dev.researchhub.source.infrastructure.SourceExtractionRepository extractions;

    @BeforeEach void clear() { jdbc.execute("TRUNCATE users,workspaces CASCADE"); }

    @Test void indexesRealWritesCurrentVersionsAnswersRepliesAndResultMetadataTransactionally() throws Exception {
        var owner=browser();owner.signUp("projection-owner@example.com","Owner");
        UUID workspace=UUID.fromString(owner.createdWorkspaceId("Projection","Five types"));
        UUID anchor=UUID.randomUUID();String text="uniquedocumentneedle";
        var doc=owner.postJson("/api/workspaces/"+workspace+"/documents","""
            {"title":"Synthetic document","content":{"type":"doc","content":[{"type":"paragraph","content":[
              {"type":"text","text":"%s","marks":[{"type":"commentAnchor","attrs":{"ids":["%s"]}}]}]}]}}
            """.formatted(text,anchor));
        assertEquals(201,doc.statusCode(),doc.body());String docId=owner.json(doc).get("id").asString();
        String docPath="/api/workspaces/"+workspace+"/documents/"+docId;
        UUID comment=UUID.randomUUID();var createdComment=owner.postJson(docPath+"/comments",json.writeValueAsString(java.util.Map.of(
            "id",comment,"body","uniquecommentneedle","anchor",java.util.Map.of("strategy","TEXT_MARK_V1","id",anchor,"quote",text))));
        assertEquals(201,createdComment.statusCode(),createdComment.body());
        assertEquals(201,owner.postJson(docPath+"/comments/"+comment+"/replies",json.writeValueAsString(java.util.Map.of("id",UUID.randomUUID(),"body","uniquereplyneedle"))).statusCode());
        assertEquals("COMMENT",owner.json(owner.get(search(workspace,"uniquereplyneedle"))).path("items").get(0).path("type").asString());

        var source=owner.postFile("/api/workspaces/"+workspace+"/sources","synthetic.txt","text/plain","Synthetic source".getBytes());
        assertEquals(201,source.statusCode(),source.body());var sourceJson=owner.json(source);
        UUID sourceId=UUID.fromString(sourceJson.path("id").asString()),version=UUID.fromString(sourceJson.path("activeVersionId").asString());
        UUID job=jdbc.queryForObject("SELECT id FROM processing_jobs WHERE workspace_id=? AND resource_id=?",UUID.class,workspace,sourceId);
        String extractionText="uniqueextractionneedle";
        extractions.save(workspace,sourceId,version,job,new dev.researchhub.processing.application.SourceExtraction("test","test",
            new dev.researchhub.processing.application.SourceExtraction.ExtractionMetadata(null,null,null,0,extractionText.length(),sourceJson.path("contentSha256").asString()),
            new dev.researchhub.processing.application.SourceExtraction.DocumentStructure(java.util.List.of(),java.util.List.of()),
            java.util.List.of(new dev.researchhub.processing.application.SourceExtraction.ExtractedChunk(sourceId,"test",null,"unit",0,extractionText,null,null,0,extractionText.length())),null,java.util.List.of()),Instant.now());
        var found=owner.json(owner.get(search(workspace,extractionText))).path("items").get(0);
        assertEquals(version.toString(),found.path("sourceVersion").asString());assertTrue(found.path("location").asString().endsWith("?version="+version));
        dev.researchhub.source.SourceRowFixture.addVersion(jdbc,sourceId,2,"replacement.txt","text/plain","TXT",10,"sources/"+UUID.randomUUID(),"b".repeat(64),"READY",Instant.now());
        assertEquals(0,owner.json(owner.get(search(workspace,extractionText))).path("items").size(),"Old extraction must not survive active-version replacement");

        var conversation=owner.postJson("/api/workspaces/"+workspace+"/ai/conversations","{\"title\":\"Synthetic conversation\"}");
        String conversationId=owner.json(conversation).path("id").asString();
        jdbc.update("""
            INSERT INTO ai_messages(id,workspace_id,conversation_id,client_request_id,sequence,role,status,content,response,completed_at)
            VALUES (?,?,?,?,2,'ASSISTANT','COMPLETED','uniqueanswerneedle','{"answer":"uniqueanswerneedle"}'::jsonb,now())
            """,UUID.randomUUID(),workspace,UUID.fromString(conversationId),UUID.randomUUID());
        assertTrue(owner.json(owner.get(search(workspace,"uniqueanswerneedle"))).path("items").get(0).path("location").asString().endsWith("?conversation="+conversationId));

        String problem=java.nio.file.Files.readString(java.nio.file.Path.of("..","contracts","analysis","computation-plan","v2","problem-create.json"))
            .replace("Calculate speed from distance and elapsed time.","uniqueanalysisneedle Calculate speed from distance and elapsed time.");
        var analysis=owner.postJson("/api/workspaces/"+workspace+"/analyses",problem);
        assertEquals(201,analysis.statusCode(),analysis.body());assertEquals("ANALYSIS",owner.json(owner.get(search(workspace,"uniqueanalysisneedle"))).path("items").get(0).path("type").asString());

        assertEquals(1,owner.json(owner.get(search(workspace,text)+"&types=DOCUMENT")).path("items").size());
        assertEquals(204,owner.delete(docPath).statusCode());
        assertEquals(0,owner.json(owner.get(search(workspace,text))).path("items").size(),"Archiving hides the document and its comments");
        assertEquals(0,jdbc.queryForObject("SELECT count(*) FROM ai_generation_runs",Integer.class));
    }

    @Test
    void allFiveTypesHaveStableDeepLinksPaginationAndArchivedFiltering() throws Exception {
        var owner = browser();
        owner.signUp("search-owner@example.com", "Owner");
        UUID workspace = UUID.fromString(owner.createdWorkspaceId("Search", "Workspace search"));
        Instant now = Instant.parse("2026-10-13T12:00:00Z");
        String[] types = {"DOCUMENT", "SOURCE", "CONVERSATION", "COMMENT", "ANALYSIS"};
        for (int index = 0; index < types.length; index++)
            insert(workspace, types[index], UUID.randomUUID(), types[index] + " title",
                    "plain <script>alert(1)</script> sharedneedle content", "/app/deep/" + types[index],
                    types[index].equals("SOURCE") ? "source-version" : String.valueOf(index + 1),
                    now.minusSeconds(index), false);
        insert(workspace, "DOCUMENT", UUID.randomUUID(), "Archived", "sharedneedle", "/archived", "1", now, true);

        var first = owner.get(search(workspace, "sharedneedle") + "&limit=3");
        assertEquals(200, first.statusCode(), first.body());
        assertEquals(3, owner.json(first).get("items").size());
        String cursor = owner.json(first).get("nextCursor").asString();
        var second = owner.get(search(workspace, "sharedneedle") + "&limit=3&cursor=" + URLEncoder.encode(cursor, StandardCharsets.UTF_8));
        assertEquals(2, owner.json(second).get("items").size());
        assertTrue(owner.json(second).get("nextCursor").isNull());
        var seen = new HashSet<String>();
        owner.json(first).get("items").forEach(item -> seen.add(item.get("type").asString()));
        owner.json(second).get("items").forEach(item -> seen.add(item.get("type").asString()));
        assertEquals(Set.of(types), seen);
        assertTrue(owner.json(first).get("items").get(0).get("location").asString().startsWith("/app/"));
        assertTrue(owner.json(first).get("items").get(0).get("snippet").asString().contains("sharedneedle"));

        var filtered = owner.get(search(workspace, "sharedneedle") + "&types=COMMENT,SOURCE");
        assertEquals(2, owner.json(filtered).get("items").size());
        for(String suffix:java.util.List.of("&limit=invalid","&limit=0","&limit=51","&types=unknown","&cursor=invalid"))
            assertEquals(400,owner.get(search(workspace,"sharedneedle")+suffix).statusCode(),suffix);
        assertEquals(400,owner.get("/api/workspaces/"+workspace+"/search").statusCode());
    }

    @Test
    void foreignWorkspaceAndRevokedMemberReceiveNoSnippetOrCount() throws Exception {
        var owner = browser();
        owner.signUp("isolation-owner@example.com", "Owner");
        UUID workspace = UUID.fromString(owner.createdWorkspaceId("Private", "Private search"));
        insert(workspace, "DOCUMENT", UUID.randomUUID(), "Secret title", "uniquesecret", "/secret", "1", Instant.now(), false);

        var outsider = browser();
        outsider.signUp("search-outsider@example.com", "Outsider");
        var foreign = outsider.get(search(workspace, "uniquesecret"));
        assertEquals(404, foreign.statusCode(), foreign.body());
        assertFalse(foreign.body().contains("Secret title"));
        assertFalse(foreign.body().contains("uniquesecret"));

        var member = browser();
        String memberId = member.signUp("search-member@example.com", "Member");
        assertEquals(201, owner.postJson("/api/workspaces/" + workspace + "/members", """
                {"email":"search-member@example.com","role":"VIEWER"}
                """).statusCode());
        assertEquals(1, member.json(member.get(search(workspace, "uniquesecret"))).get("items").size());
        assertEquals(204, owner.delete("/api/workspaces/" + workspace + "/members/" + memberId).statusCode());
        var revoked = member.get(search(workspace, "uniquesecret"));
        assertEquals(404, revoked.statusCode(), revoked.body());
        assertFalse(revoked.body().contains("Secret title"));
    }

    @Test
    void lexicalSearchP95IsBelow500msForTenThousandSyntheticObjects() throws Exception {
        var owner = browser();
        UUID caller=UUID.fromString(owner.signUp("search-performance@example.com", "Owner"));
        UUID workspace = UUID.fromString(owner.createdWorkspaceId("Benchmark", "10k synthetic objects"));
        jdbc.update("""
                INSERT INTO workspace_search_entries(workspace_id,type,object_id,title,content,location,updated_at,archived)
                SELECT ?,CASE i%5 WHEN 0 THEN 'DOCUMENT' WHEN 1 THEN 'SOURCE' WHEN 2 THEN 'CONVERSATION'
                         WHEN 3 THEN 'COMMENT' ELSE 'ANALYSIS' END,
                       md5('search-fixture-'||i)::uuid,'Synthetic object '||i,
                       'benchmarktoken reproducible synthetic content '||i,'/app/fixture/'||i,
                       now()-(i||' milliseconds')::interval,false
                FROM generate_series(1,10000) i
                """, workspace);
        jdbc.execute("ANALYZE workspace_search_entries");
        String path = search(workspace, "benchmarktoken") + "&limit=50";
        for (int index = 0; index < 3; index++) assertEquals(200, owner.get(path).statusCode());
        var millis = new ArrayList<Long>();
        for (int index = 0; index < 20; index++) {
            long started = System.nanoTime();
            var response = owner.get(path);
            millis.add((System.nanoTime() - started) / 1_000_000);
            assertEquals(200, response.statusCode(), response.body());
            assertEquals(50, owner.json(response).get("items").size());
        }
        millis.sort(Long::compareTo);
        long p95 = millis.get(18);
        assertTrue(p95 <= 500, "10k lexical search p95 was " + p95 + "ms; samples=" + millis);
        String plan=jdbc.queryForObject("""
            EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON)
            SELECT type,object_id,title,location,source_version,updated_at FROM workspace_search_entries e
            WHERE workspace_id=? AND archived=false AND search_vector @@ websearch_to_tsquery('simple','benchmarktoken')
                AND EXISTS(SELECT 1 FROM workspace_members m JOIN workspaces w ON w.id=m.workspace_id
                    WHERE m.workspace_id=? AND m.user_id=? AND w.erasure_requested_at IS NULL)
            ORDER BY updated_at DESC,type ASC,object_id DESC LIMIT 51
            """,String.class,workspace,workspace,caller);
        var evidence=java.util.Map.of("objects",10000,"samplesMillis",millis,"p95Millis",p95,"queryPlan",json.readTree(plan),
            "javaVersion",System.getProperty("java.version"),"os",System.getProperty("os.name"),"architecture",System.getProperty("os.arch"),
            "processors",Runtime.getRuntime().availableProcessors(),"postgres",jdbc.queryForObject("SELECT version()",String.class));
        java.nio.file.Files.writeString(java.nio.file.Path.of("target","task35-search-benchmark.json"),json.writerWithDefaultPrettyPrinter().writeValueAsString(evidence));
    }

    private ApiBrowser browser() { return new ApiBrowser(port, json); }
    private static String search(UUID workspace, String query) {
        return "/api/workspaces/" + workspace + "/search?q=" + URLEncoder.encode(query, StandardCharsets.UTF_8);
    }
    private void insert(UUID workspace, String type, UUID id, String title, String content, String location,
                        String version, Instant updated, boolean archived) {
        jdbc.update("""
                INSERT INTO workspace_search_entries(workspace_id,type,object_id,title,content,location,source_version,updated_at,archived)
                VALUES (?,?,?,?,?,?,?,?,?)
                """, workspace, type, id, title, content, location, version, Timestamp.from(updated), archived);
    }
}
