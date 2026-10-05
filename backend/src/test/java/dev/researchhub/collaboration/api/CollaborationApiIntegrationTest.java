package dev.researchhub.collaboration.api;

import dev.researchhub.shared.infrastructure.persistence.PostgresTestcontainersConfiguration;
import dev.researchhub.support.ApiBrowser;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import java.net.URI;
import java.net.http.*;
import java.nio.file.Path;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = {
        "researchhub.collaboration.enabled=true", "researchhub.collaboration.service-token=integration-service-key-at-least-32-bytes"
})
@ActiveProfiles("local")
@Import(PostgresTestcontainersConfiguration.class)
class CollaborationApiIntegrationTest {
    static final String KEY = "integration-service-key-at-least-32-bytes";
    static final String CONTENT = "{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\"}]}";
    @Value("${local.server.port}") int port;
    @Autowired ObjectMapper json;
    @Autowired JdbcTemplate jdbc;
    ApiBrowser owner, editor, viewer, outsider;
    String workspace, document, editorId, route, token, room;
    @BeforeEach void setup() throws Exception {
        jdbc.execute("TRUNCATE collaboration_credentials, collaboration_documents, document_versions, documents, workspace_members, workspaces, users CASCADE");
        owner = new ApiBrowser(port, json); editor = new ApiBrowser(port, json); viewer = new ApiBrowser(port, json); outsider = new ApiBrowser(port, json);
        owner.signUp("owner@collab.test", "Owner"); editorId = editor.signUp("editor@collab.test", "Editor"); viewer.signUp("viewer@collab.test", "Viewer"); outsider.signUp("outsider@collab.test", "Outsider");
        workspace = json.readTree(owner.postJson("/api/workspaces", "{\"name\":\"Realtime\"}").body()).path("id").asText();
        String members = "/api/workspaces/"+workspace+"/members";
        assertEquals(201, owner.postJson(members, "{\"email\":\"editor@collab.test\",\"role\":\"EDITOR\"}").statusCode());
        assertEquals(201, owner.postJson(members, "{\"email\":\"viewer@collab.test\",\"role\":\"VIEWER\"}").statusCode());
        String docs = "/api/workspaces/"+workspace+"/documents";
        document = json.readTree(owner.postJson(docs, "{\"title\":\"Report\",\"content\":"+CONTENT+"}").body()).path("id").asText();
        route = docs+"/"+document;
        var response = editor.postJson(route+"/collaboration/credential", "{}");
        assertEquals(200, response.statusCode()); assertEquals("no-store", response.headers().firstValue("Cache-Control").orElseThrow());
        var credential = json.readTree(response.body()); token = credential.path("token").asText(); room = credential.path("room").asText();
    }
    HttpResponse<String> internal(String path, Object body, String key) throws Exception {
        var request = HttpRequest.newBuilder(URI.create("http://localhost:"+port+"/internal/collaboration/"+path))
                .header("Content-Type", "application/json").header("X-Collaboration-Service-Token",key)
                .POST(HttpRequest.BodyPublishers.ofString(json.writeValueAsString(body))).build();
        return HttpClient.newHttpClient().send(request,HttpResponse.BodyHandlers.ofString());
    }
    Map<String,String> access(String credential, String target) { return Map.of("token",credential,"room",target); }
    @Test void deniesNonMembersViewersSubstitutionAnonymousAndUntrustedServices() throws Exception {
        assertEquals(404, outsider.postJson(route+"/collaboration/credential", "{}").statusCode());
        assertEquals(403, viewer.postJson(route+"/collaboration/credential", "{}").statusCode());
        assertEquals(401, new ApiBrowser(port,json).postJson(route+"/collaboration/credential", "{}").statusCode());
        assertEquals(404, editor.postJson("/api/workspaces/"+UUID.randomUUID()+"/documents/"+document+"/collaboration/credential", "{}").statusCode());
        var authorized = internal("authorize", access(token,room),KEY);
        assertEquals(200, authorized.statusCode());
        var presence = json.readTree(authorized.body()).path("user");
        assertEquals(editorId, presence.path("userId").asText());
        assertEquals("Editor", presence.path("displayName").asText());
        assertEquals(3, presence.size()); assertFalse(authorized.body().contains("email"));
        assertEquals(403, internal("authorize", access(token,"document:"+UUID.randomUUID()),KEY).statusCode());
        assertEquals(403, internal("authorize", access("invalid",room),KEY).statusCode());
        assertEquals(403, internal("authorize", access("a".repeat(43),room),KEY).statusCode());
        assertEquals(401, internal("authorize", access(token,room),"wrong").statusCode());
        assertEquals(401, editor.postJson("/internal/collaboration/authorize",json.writeValueAsString(access(token,room))).statusCode());
        assertEquals(403, editor.sendWithoutCsrf("POST",route+"/collaboration/credential","{}").statusCode());
        jdbc.update("UPDATE collaboration_credentials SET expires_at = now() - interval '1 second'");
        assertEquals(403, internal("authorize", access(token,room),KEY).statusCode());
    }
    @Test void rechecksCurrentMembershipAndArchivesIncludingAlreadyIssuedTokens() throws Exception {
        String members = "/api/workspaces/"+workspace+"/members/"+editorId;
        assertEquals(200, owner.patchJson(members,"{\"role\":\"VIEWER\"}").statusCode());
        assertEquals(403, internal("authorize",access(token,room),KEY).statusCode());
        owner.patchJson(members,"{\"role\":\"EDITOR\"}");
        assertEquals(200, internal("authorize",access(token,room),KEY).statusCode());
        owner.delete(members);
        assertEquals(404, internal("authorize",access(token,room),KEY).statusCode());
        assertEquals(404, editor.postJson(route+"/collaboration/credential","{}").statusCode());
        String ownerToken = json.readTree(owner.postJson(route+"/collaboration/credential","{}").body()).path("token").asText();
        owner.delete(route);
        assertEquals(409, internal("authorize",access(ownerToken,room),KEY).statusCode());
    }
    @Test void archivedWorkspaceAndDisabledAccountEndPreviouslyIssuedCredentials() throws Exception {
        var issued = json.readTree(editor.postJson(route+"/collaboration/credential", "{}").body());
        assertEquals("Editor", issued.path("user").path("displayName").asText());
        assertFalse(issued.toString().contains("email"));
        jdbc.update("UPDATE users SET status='DISABLED' WHERE id=?", UUID.fromString(editorId));
        assertEquals(403, internal("authorize", access(token,room),KEY).statusCode());
        jdbc.update("UPDATE users SET status='ACTIVE' WHERE id=?", UUID.fromString(editorId));
        assertEquals(200, owner.postJson("/api/workspaces/"+workspace+"/archive","{}").statusCode());
        assertEquals(409, internal("authorize", access(token,room),KEY).statusCode());
        assertEquals(409, editor.postJson(route+"/collaboration/credential", "{}").statusCode());
    }
    @Test void snapshotsAndProjectionAreAtomicAndLegacyWritersCannotOverwriteRealtime() throws Exception {
        assertEquals(200, internal("load",access(token,room),KEY).statusCode());
        assertEquals(409, editor.patchJson(route,"{\"title\":\"Legacy\",\"revision\":1,\"content\":"+CONTENT+"}").statusCode());
        var request = Map.of("token",token,"sequence",0,"state","AQ==","snapshotId",UUID.randomUUID(),"title","Realtime", "content", CONTENT);
        assertEquals(200,internal("rooms/"+room+"/snapshot",request,KEY).statusCode());
        var read = json.readTree(viewer.get(route).body()); assertEquals("Realtime",read.path("title").asText()); assertEquals(2,read.path("revision").asInt());
        var load = json.readTree(internal("load",access(token,room),KEY).body()); assertEquals("AQ==",load.path("state").asText()); assertEquals(1,load.path("sequence").asInt());
        assertEquals(200,internal("rooms/"+room+"/snapshot",request,KEY).statusCode());
        assertEquals(2,json.readTree(viewer.get(route).body()).path("revision").asInt(),"A retry does not advance revision");
        var stale = new java.util.HashMap<>(request); stale.put("snapshotId", UUID.randomUUID());
        assertEquals(409,internal("rooms/"+room+"/snapshot",stale,KEY).statusCode());
        var altered = new java.util.HashMap<>(request); altered.put("state", "Ag==");
        assertEquals(409,internal("rooms/"+room+"/snapshot",altered,KEY).statusCode());
        assertEquals(200,editor.postJson(route+"/collaboration/checkpoint","{}").statusCode());
        assertEquals(200,editor.postJson(route+"/collaboration/checkpoint","{}").statusCode());
        String version = json.readTree(viewer.get(route+"/versions").body()).get(0).path("id").asText();
        assertEquals(409,editor.postJson(route+"/versions/"+version+"/restore","{\"revision\":2}").statusCode());
        var bad = Map.of("token",token,"sequence",1,"state","Ag==","snapshotId",UUID.randomUUID(),"title","", "content", CONTENT);
        assertEquals(400,internal("rooms/"+room+"/snapshot",bad,KEY).statusCode());
        assertEquals(1,jdbc.queryForObject("SELECT sequence FROM collaboration_documents WHERE document_id=?",Long.class,UUID.fromString(document)));
        assertEquals(400,internal("rooms/"+room+"/snapshot",Map.of("token",token,"sequence",1,"state","!","snapshotId",UUID.randomUUID(), "title","T", "content","[]"),KEY).statusCode());
    }
    @Test void twoWebsocketClientsUseRealSpringAuthorizationAndRecoverAfterServiceRestart() throws Exception {
        String ownerToken = json.readTree(owner.postJson(route+"/collaboration/credential","{}").body()).path("token").asText();
        ProcessBuilder builder = new ProcessBuilder("node", "test/spring-e2e.mjs");
        builder.directory(Path.of("../collaboration").toFile());
        builder.environment().put("COLLABORATION_BACKEND_URL","http://127.0.0.1:"+port);
        builder.environment().put("COLLABORATION_SERVICE_TOKEN",KEY);
        builder.environment().put("E2E_TOKENS",json.writeValueAsString(new String[]{token,ownerToken}));
        builder.environment().put("E2E_ROOM",room);
        var output = Path.of("target/collaboration-e2e.log").toFile(); builder.redirectErrorStream(true).redirectOutput(output);
        Process child = builder.start();
        try { assertTrue(child.waitFor(40, TimeUnit.SECONDS),"Node E2E timed out"); assertEquals(0,child.exitValue(),java.nio.file.Files.readString(output.toPath())); }
        finally {child.destroyForcibly();}
        var read = json.readTree(viewer.get(route).body()); assertEquals("Simultaneous report",read.path("title").asText()); assertTrue(read.path("content").toString().contains("Both authors"));
    }

    @Test void upgradesV25HashesAndFailsClosedOnMissingOrCorruptCommittedState() throws Exception {
        internal("load",access(token,room),KEY);
        var request = Map.of("token",token,"sequence",0,"state","AQ==","snapshotId",UUID.randomUUID(),"title","Report", "content", CONTENT);
        assertEquals(200,internal("rooms/"+room+"/snapshot",request,KEY).statusCode());
        jdbc.update("UPDATE collaboration_documents SET last_snapshot_id=NULL,state_sha256=NULL");
        var upgraded = json.readTree(internal("load",access(token,room),KEY).body());
        assertEquals(64,upgraded.path("stateSha256").asText().length());
        assertEquals("AQ==",upgraded.path("state").asText());
        jdbc.update("UPDATE collaboration_documents SET state_sha256=?","0".repeat(64));
        assertEquals(409,internal("load",access(token,room),KEY).statusCode());
        jdbc.update("UPDATE collaboration_documents SET state=NULL,state_sha256=NULL,last_snapshot_id=NULL");
        assertEquals(409,internal("load",access(token,room),KEY).statusCode());
        assertEquals(200,viewer.get(route).statusCode(),"Committed materialization remains readable during controlled recovery");
        assertEquals(409,editor.patchJson(route,"{\"title\":\"Legacy\",\"revision\":2,\"content\":"+CONTENT+"}").statusCode());
    }
    @Test void rejectsMalformedSnapshotsAndKeepsOneVersionedStatePerRoom() throws Exception {
        internal("load",access(token,room),KEY);
        for (int sequence=0;sequence<12;sequence++) {
            var request=Map.of("token",token,"sequence",sequence,"state","AQ==","snapshotId",UUID.randomUUID(),"title","Report "+sequence,"content",CONTENT);
            assertEquals(200,internal("rooms/"+room+"/snapshot",request,KEY).statusCode());
        }
        assertEquals(1,jdbc.queryForObject("SELECT count(*) FROM collaboration_documents",Integer.class));
        assertEquals(12,jdbc.queryForObject("SELECT sequence FROM collaboration_documents",Long.class));
        for (var bad : java.util.List.of(
                Map.of("token",token,"sequence",-1,"state","AQ==","snapshotId",UUID.randomUUID(),"title","Report","content",CONTENT),
                Map.of("token",token,"sequence",12,"state","","snapshotId",UUID.randomUUID(),"title","Report","content",CONTENT),
                Map.of("token",token,"sequence",12,"state","AQ==","snapshotId",UUID.randomUUID(),"title","Report","content","[]"),
                Map.of("token",token,"sequence",12,"state","AQ==","title","Report","content",CONTENT))) {
            assertEquals(400,internal("rooms/"+room+"/snapshot",bad,KEY).statusCode());
        }
        assertEquals(12,jdbc.queryForObject("SELECT sequence FROM collaboration_documents",Long.class));
    }
    @Test
    @org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable(named="COLLABORATION_BROWSER_TESTS",matches="true")
    void twoBrowserSessionsMergeUndoReconnectAndSurviveProcessRestart() throws Exception {
        ProcessBuilder builder=new ProcessBuilder("node","e2e/realtime.cjs");
        builder.directory(Path.of("../frontend").toFile());
        builder.environment().put("E2E_BACKEND_URL","http://127.0.0.1:"+port);
        builder.environment().put("E2E_DOCUMENT_ROUTE",route);
        builder.environment().put("E2E_EDITOR_ID",editorId);
        builder.environment().put("COLLABORATION_SERVICE_TOKEN",KEY);
        var output=Path.of("target/collaboration-browser-e2e.log").toFile();
        builder.redirectErrorStream(true).redirectOutput(output);
        Process child=builder.start();
        try {assertTrue(child.waitFor(150,TimeUnit.SECONDS),"Browser E2E timed out");assertEquals(0,child.exitValue(),java.nio.file.Files.readString(output.toPath()));}
        finally {child.destroyForcibly();}
        var read=json.readTree(viewer.get(route).body());
        assertTrue(read.path("content").toString().contains("ALPHA"));
        assertTrue(read.path("content").toString().contains("BETA"));
        assertTrue(read.path("content").toString().contains("RECOVERED"));
    }
}
