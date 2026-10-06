package dev.researchhub.document.api;

import dev.researchhub.shared.infrastructure.persistence.PostgresTestcontainersConfiguration;
import dev.researchhub.support.ApiBrowser;
import dev.researchhub.document.application.DocumentSnapshotScheduler;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.*;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import tools.jackson.databind.*;
import java.net.URI;
import java.net.http.*;
import java.time.*;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT,properties={"researchhub.collaboration.enabled=true","researchhub.collaboration.service-token=integration-service-key-at-least-32-bytes","researchhub.processing.dispatcher.enabled=false","researchhub.analysis.execution.dispatcher.enabled=false","researchhub.documents.history.scheduler.fixed-delay=PT1H"})
@ActiveProfiles("local")
@Import(PostgresTestcontainersConfiguration.class)
class DocumentOriginsAndSnapshotsApiTest {
    @Value("${local.server.port}") int port;
    @Autowired ObjectMapper json;
    @Autowired JdbcTemplate jdbc;
    @Autowired DocumentSnapshotScheduler scheduler;
    @MockitoBean Clock clock;
    ApiBrowser owner,viewer,outsider;
    String workspace,document,path,viewerId; UUID block;
    Instant now=Instant.parse("2026-10-06T12:00:00Z");
    @BeforeEach void setup() throws Exception {
        jdbc.execute("TRUNCATE users,workspaces CASCADE"); when(clock.instant()).thenReturn(now);
        owner=new ApiBrowser(port,json); owner.signUp("origin-owner@example.com","Original owner");
        viewer=new ApiBrowser(port,json); viewerId=viewer.signUp("origin-viewer@example.com","Viewer");
        outsider=new ApiBrowser(port,json); outsider.signUp("origin-outsider@example.com","Outsider");
        workspace=owner.createdWorkspaceId("Origins","History");
        assertEquals(201,owner.postJson("/api/workspaces/"+workspace+"/members","{\"email\":\"origin-viewer@example.com\",\"role\":\"VIEWER\"}").statusCode());
        block=UUID.randomUUID(); var created=owner.postJson("/api/workspaces/"+workspace+"/documents",json.writeValueAsString(Map.of("title","Report","content",body("First",false))));
        assertEquals(201,created.statusCode(),created.body()); document=owner.json(created).path("id").asString(); path="/api/workspaces/"+workspace+"/documents/"+document;
    }
    JsonNode body(String text,boolean imported) {
        var root=json.createObjectNode().put("type","doc"); var node=root.putArray("content").addObject().put("type","paragraph");
        var attrs=node.putObject("attrs").put("blockId",block.toString()); if(imported) attrs.put("originIntent","IMPORTED");
        node.putArray("content").addObject().put("type","text").put("text",text); return root;
    }
    JsonNode current() throws Exception {return owner.json(owner.get(path));}
    JsonNode versions() throws Exception {return owner.json(owner.get(path+"/versions"));}
    JsonNode save(String text,boolean imported) throws Exception {
        var result=owner.patchJson(path,json.writeValueAsString(Map.of("title","Current title","content",body(text,imported),"revision",current().path("revision").asLong(),"saveKind","AUTOSAVE")));
        assertEquals(200,result.statusCode(),result.body());return owner.json(result);
    }
    JsonNode snapshot(String name) throws Exception {
        var response=owner.postJson(path+"/snapshots",json.writeValueAsString(Map.of("revision",current().path("revision").asLong(),"name",name)));
        assertEquals(201,response.statusCode(),response.body());return owner.json(response);
    }
    String provenance() { return path+"/blocks/"+block+"/provenance"; }
    @Test void trackedHumanAndImportedBlocksHaveImmutableScopedOperationHistoryWithoutReportText() throws Exception {
        var first=viewer.json(viewer.get(provenance())); assertEquals("HUMAN",first.get(0).path("category").asString());
        assertEquals("Original owner",first.get(0).path("actorName").asString()); assertFalse(first.toString().contains("First"));
        save("Edited",false); assertEquals(2,owner.json(owner.get(provenance())).size());
        save("Edited",false); assertEquals(2,owner.json(owner.get(provenance())).size());
        block=UUID.randomUUID();save("Imported text",true);
        assertEquals("IMPORTED",owner.json(owner.get(provenance())).get(0).path("category").asString());
        assertEquals(404,outsider.get(provenance()).statusCode());
        assertEquals(404,viewer.get(provenance().replace(document,UUID.randomUUID().toString())).statusCode());
        assertEquals(404,viewer.get(provenance().replace(block.toString(),UUID.randomUUID().toString())).statusCode());
        assertThrows(org.springframework.dao.DataAccessException.class,() -> jdbc.update("UPDATE document_content_operations SET actor_name='AI'"));
        assertThrows(org.springframework.dao.DataAccessException.class,() -> jdbc.update("DELETE FROM document_content_operations"));
    }
    @Test void eachInlinePasteIsRecordedAsImportAndLaterTypingAsHuman() throws Exception {
        var imported=body("Pasted into existing block",true);
        var attrs=(tools.jackson.databind.node.ObjectNode)imported.path("content").get(0).path("attrs");
        attrs.put("importOperationId",UUID.randomUUID().toString());
        var response=owner.patchJson(path,json.writeValueAsString(Map.of("title","Report","content",imported,"revision",1,"saveKind","AUTOSAVE")));
        assertEquals(200,response.statusCode(),response.body());
        assertEquals("IMPORTED",owner.json(owner.get(provenance())).get(0).path("category").asString());
        ((tools.jackson.databind.node.ObjectNode)imported.path("content").get(0).path("content").get(0)).put("text","Typed after paste");
        assertEquals(200,owner.patchJson(path,json.writeValueAsString(Map.of("title","Report","content",imported,"revision",2,"saveKind","AUTOSAVE"))).statusCode());
        assertEquals("HUMAN",owner.json(owner.get(provenance())).get(0).path("category").asString());
        attrs.put("importOperationId",UUID.randomUUID().toString());
        assertEquals(200,owner.patchJson(path,json.writeValueAsString(Map.of("title","Report","content",imported,"revision",3,"saveKind","AUTOSAVE"))).statusCode());
        var history=owner.json(owner.get(provenance()));assertEquals(4,history.size());assertEquals("IMPORTED",history.get(0).path("category").asString());
    }
    @Test void invalidOrDuplicateBlockIdentitiesFailAtomicallyAndClientsCannotClaimAiOrigin() throws Exception {
        var malformed=body("forged",false); ((tools.jackson.databind.node.ObjectNode)malformed.path("content").get(0).path("attrs")).put("originIntent","AI_GENERATED");
        assertEquals(400,owner.patchJson(path,json.writeValueAsString(Map.of("title","Report","content",malformed,"revision",1,"saveKind","MANUAL"))).statusCode());
        assertEquals(1,current().path("revision").asLong());
        ((tools.jackson.databind.node.ObjectNode)malformed.path("content").get(0).path("attrs")).remove("originIntent");
        ((tools.jackson.databind.node.ArrayNode)malformed.path("content")).add(malformed.path("content").get(0));
        assertEquals(400,owner.patchJson(path,json.writeValueAsString(Map.of("title","Report","content",malformed,"revision",1,"saveKind","MANUAL"))).statusCode());
        ((tools.jackson.databind.node.ArrayNode)malformed.path("content")).remove(1);
        ((tools.jackson.databind.node.ObjectNode)malformed.path("content").get(0).path("attrs")).put("blockId","invalid");
        assertEquals(400,owner.patchJson(path,json.writeValueAsString(Map.of("title","Report","content",malformed,"revision",1,"saveKind","MANUAL"))).statusCode());
        assertEquals(1,jdbc.queryForObject("SELECT count(*) FROM document_content_operations",Integer.class));
    }
    @Test void namedSnapshotsCaptureSameRevisionIndependentlyAndRestorePreservesEveryLaterVersionAndCurrentText() throws Exception {
        var first=snapshot("Before review"); var second=snapshot("Ready for peer review");
        assertNotEquals(first.path("id"),second.path("id"));assertEquals(first.path("revision"),second.path("revision"));
        save("Later state",false); var later=snapshot("Later edits"); save("Unsnapshotted current",false);
        int old=versions().size();
        var response=owner.postJson(path+"/versions/"+first.path("id").asString()+"/restore",json.writeValueAsString(Map.of("revision",current().path("revision").asLong())));
        assertEquals(200,response.statusCode(),response.body());assertEquals("Current title",owner.json(response).path("title").asString());
        assertEquals("First",owner.json(response).path("content").path("content").get(0).path("content").get(0).path("text").asString());
        var after=versions();assertEquals(old+2,after.size());assertEquals("RESTORE",after.get(0).path("reason").asString());
        assertEquals(first.path("id"),after.get(0).path("restoredFromVersionId"));
        assertTrue(after.toString().contains(later.path("id").asString()));assertTrue(after.toString().contains("Before restore"));
        var rollback=after.get(1);assertEquals("Unsnapshotted current",owner.json(owner.get(path+"/versions/"+rollback.path("id").asString())).path("content").path("content").get(0).path("content").get(0).path("text").asString());
    }
    @Test void snapshotWritesRequireRoleScopeCurrentRevisionAndCsrfAndKeepActorNamesAfterRemoval() throws Exception {
        String input="{\"revision\":1,\"name\":\"Review\"}";
        assertEquals(403,viewer.postJson(path+"/snapshots",input).statusCode());assertEquals(404,outsider.postJson(path+"/snapshots",input).statusCode());
        assertEquals(403,owner.sendWithoutCsrf("POST",path+"/snapshots",input).statusCode());
        assertEquals(400,owner.postJson(path+"/snapshots","{\"revision\":1,\"name\":\" \"}").statusCode());
        assertEquals(409,owner.postJson(path+"/snapshots","{\"revision\":2,\"name\":\"Review\"}").statusCode());
        owner.patchJson("/api/workspaces/"+workspace+"/members/"+viewerId,"{\"role\":\"EDITOR\"}");
        var response=viewer.postJson(path+"/snapshots",input);assertEquals(201,response.statusCode());
        owner.delete("/api/workspaces/"+workspace+"/members/"+viewerId);
        assertTrue(versions().toString().contains("Viewer"));
    }
    HttpResponse<String> internal(String endpoint,Object body) throws Exception {
        return HttpClient.newHttpClient().send(HttpRequest.newBuilder(URI.create("http://localhost:"+port+"/internal/collaboration/"+endpoint)).header("Content-Type","application/json").header("X-Collaboration-Service-Token","integration-service-key-at-least-32-bytes").POST(HttpRequest.BodyPublishers.ofString(json.writeValueAsString(body))).build(),HttpResponse.BodyHandlers.ofString());
    }
    @Test void collaborationSnapshotsFreezeBinaryReceiptsAndRestoreRetiresOldAndOfflineReplicas() throws Exception {
        var credential=owner.json(owner.postJson(path+"/collaboration/credential","{}"));String token=credential.path("token").asString(),room=credential.path("room").asString();
        assertEquals(200,internal("load",Map.of("token",token,"room",room)).statusCode());
        var saved=internal("rooms/"+room+"/snapshot",Map.of("token",token,"sequence",0,"snapshotId",UUID.randomUUID(),"state","AQID","title","Report","content",json.writeValueAsString(body("Collaborative",false))));assertEquals(200,saved.statusCode(),saved.body());
        var snapshot=snapshot("Collaborative milestone");assertEquals(1,snapshot.path("collaborationSequence").asLong());assertEquals(0,snapshot.path("collaborationEpoch").asLong());assertEquals(64,snapshot.path("stateSha256").asString().length());
        assertArrayEquals(new byte[]{1,2,3},jdbc.queryForObject("SELECT yjs_state FROM document_versions WHERE id=?",byte[].class,UUID.fromString(snapshot.path("id").asString())));
        var restored=owner.postJson(path+"/versions/"+snapshot.path("id").asString()+"/restore","{\"revision\":2}");assertEquals(200,restored.statusCode(),restored.body());
        var denied=internal("authorize",Map.of("token",token,"room",room));assertEquals(409,denied.statusCode());assertTrue(denied.body().contains("COLLABORATION_STATE_REPLACED"));
        assertEquals(409,internal("rooms/"+room+"/snapshot",Map.of("token",token,"sequence",1,"snapshotId",UUID.randomUUID(),"state","AQID","title","Report","content",json.writeValueAsString(body("Stale",false)))).statusCode());
        var fresh=owner.json(owner.postJson(path+"/collaboration/credential","{}"));assertEquals(room+":1",fresh.path("room").asString());
        var loaded=json.readTree(internal("load",Map.of("token",fresh.path("token").asString(),"room",fresh.path("room").asString())).body());
        assertTrue(loaded.path("state").isNull());assertEquals(0,loaded.path("sequence").asLong());assertTrue(loaded.path("content").asString().contains("Collaborative"));assertFalse(current().toString().contains("Stale"));
    }
    @Test void restoreAlsoRetiresCredentialsIssuedBeforeTheRoomWasInitialized() throws Exception {
        var credential=owner.json(owner.postJson(path+"/collaboration/credential","{}"));
        var restored=owner.postJson(path+"/versions/"+versions().get(0).path("id").asString()+"/restore","{\"revision\":1}");
        assertEquals(200,restored.statusCode(),restored.body());
        var denied=internal("authorize",Map.of("token",credential.path("token").asString(),"room",credential.path("room").asString()));
        assertEquals(409,denied.statusCode());assertTrue(denied.body().contains("COLLABORATION_STATE_REPLACED"));
    }
    @Test void failedRestoreRollsBackBinaryEpochProjectionAndHistoryTogether() throws Exception {
        var credential=owner.json(owner.postJson(path+"/collaboration/credential","{}"));
        String token=credential.path("token").asString(),room=credential.path("room").asString();
        internal("load",Map.of("token",token,"room",room));
        assertEquals(200,internal("rooms/"+room+"/snapshot",Map.of("token",token,"sequence",0,"snapshotId",UUID.randomUUID(),"state","AQID","title","Report","content",json.writeValueAsString(body("Before failure",false)))).statusCode());
        int count=versions().size();String original=versions().get(0).path("id").asString();
        jdbc.execute("CREATE FUNCTION reject_test_restore() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.reason='RESTORE' THEN RAISE EXCEPTION 'test restore failure'; END IF; RETURN NEW; END $$");
        jdbc.execute("CREATE TRIGGER reject_test_restore BEFORE INSERT ON document_versions FOR EACH ROW EXECUTE FUNCTION reject_test_restore()");
        try {
            assertEquals(500,owner.postJson(path+"/versions/"+original+"/restore","{\"revision\":2}").statusCode());
            assertEquals(count,versions().size());assertEquals(2,current().path("revision").asLong());
            assertTrue(current().toString().contains("Before failure"));
            assertEquals(0,jdbc.queryForObject("SELECT epoch FROM collaboration_documents WHERE document_id=?",Long.class,UUID.fromString(document)));
            assertArrayEquals(new byte[]{1,2,3},jdbc.queryForObject("SELECT state FROM collaboration_documents WHERE document_id=?",byte[].class,UUID.fromString(document)));
            assertEquals(200,internal("authorize",Map.of("token",token,"room",room)).statusCode());
        } finally { jdbc.execute("DROP TRIGGER reject_test_restore ON document_versions");jdbc.execute("DROP FUNCTION reject_test_restore()"); }
    }
    @Test void scheduledSnapshotsAreNamedSystemActionsOnlyForChangedActiveDocuments() throws Exception {
        when(clock.instant()).thenReturn(now.plusSeconds(60));save("Dirty after checkpoint",false);
        when(clock.instant()).thenReturn(now.plusSeconds(660));scheduler.checkpoint();
        var first=versions().get(0);assertEquals("SCHEDULED_SNAPSHOT",first.path("reason").asString());assertTrue(first.path("createdBy").isNull());assertEquals("System",first.path("actorName").asString());assertEquals("Automatic snapshot",first.path("name").asString());
        int count=versions().size();scheduler.checkpoint();assertEquals(count,versions().size());
        when(clock.instant()).thenReturn(now.plusSeconds(700));save("Archived later",false);
        owner.postJson("/api/workspaces/"+workspace+"/archive","{}");when(clock.instant()).thenReturn(now.plusSeconds(1400));scheduler.checkpoint();assertEquals(count,versions().size());
    }
}
