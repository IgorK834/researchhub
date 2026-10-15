package dev.researchhub.notification.api;

import dev.researchhub.shared.infrastructure.persistence.PostgresTestcontainersConfiguration;
import dev.researchhub.support.ApiBrowser;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.*;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import tools.jackson.databind.ObjectMapper;
import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT,properties={"researchhub.notifications.session-local-preferences=true","researchhub.notifications.dispatcher.enabled=false"})
@ActiveProfiles("local") @Import(PostgresTestcontainersConfiguration.class)
class DemoDigestApiIntegrationTest {
    @Value("${local.server.port}") int port; @Autowired ObjectMapper json;@Autowired JdbcTemplate jdbc;
    @Test void twoGuestsOnOneAccountKeepSeparateSessionPreferencesAndCursors() throws Exception {
        jdbc.execute("TRUNCATE users,workspaces CASCADE");
        try {
            var first=new ApiBrowser(port,json);var second=new ApiBrowser(port,json);first.signUp("shared@test.invalid","Shared demo");
            assertEquals(200,second.postJson("/api/auth/login","{\"email\":\"shared@test.invalid\",\"password\":\"correct-horse-battery-staple\"}").statusCode());
            String workspace=first.createdWorkspaceId("Shared lab","Demo");String route="/api/notifications/digests",pref=route+"/preferences/"+workspace;
            assertEquals(204,first.sendWithMethod("PUT",pref,"{\"frequency\":\"MUTED\",\"mutedCategories\":[\"COMMENT\"]}").statusCode());
            assertEquals("MUTED",first.json(first.get(route+"/preferences")).get(0).path("settings").path("frequency").asString());
            assertEquals("DAILY",second.json(second.get(route+"/preferences")).get(0).path("settings").path("frequency").asString());
            assertTrue(first.json(first.get(route+"/preferences")).get(0).path("sessionLocal").asBoolean());
            jdbc.update("INSERT INTO product_audit_events(id,workspace_id,event_type,resource_type,resource_id,metadata,created_at) VALUES(?,?,'COMMENT_CREATED','COMMENT',?,?::jsonb,now())",java.util.UUID.randomUUID(),java.util.UUID.fromString(workspace),java.util.UUID.randomUUID(),json.writeValueAsString(java.util.Map.of("documentId",java.util.UUID.randomUUID())));
            assertEquals(0,first.json(first.get(route)).path("sinceLastSeen").size());assertEquals(1,second.json(second.get(route)).path("sinceLastSeen").get(0).path("count").asInt());

            var through=first.json(first.get(route)).path("through").asString();assertEquals(204,first.postJson(route+"/seen",json.writeValueAsString(java.util.Map.of("through",through))).statusCode());
            assertEquals(through,first.json(first.get(route)).path("since").asString());assertNotEquals(through,second.json(second.get(route)).path("since").asString());
            assertEquals(0,jdbc.queryForObject("SELECT count(*) FROM digest_preferences",Integer.class));assertEquals(0,jdbc.queryForObject("SELECT count(*) FROM digest_seen",Integer.class));
            assertEquals(204,first.sendWithMethod("PUT",pref,"{\"frequency\":\"DAILY\",\"mutedCategories\":[]}").statusCode());
            assertEquals("DAILY",first.json(first.get(route+"/preferences")).get(0).path("settings").path("frequency").asString());
            assertEquals(204,first.sendWithMethod("PUT","/api/notifications/preferences/"+workspace,"{\"type\":\"COMMENT\",\"muted\":true}").statusCode());
            assertEquals(1,first.json(first.get("/api/notifications/preferences/"+workspace)).size());assertEquals(0,second.json(second.get("/api/notifications/preferences/"+workspace)).size());
            assertEquals(0,jdbc.queryForObject("SELECT count(*) FROM notification_preferences",Integer.class));
            assertEquals("COMMENT",first.json(first.get(route+"/preferences")).get(0).path("settings").path("mutedCategories").get(0).asString());
            assertEquals(204,first.sendWithMethod("PUT","/api/notifications/preferences/"+workspace,"{\"type\":\"COMMENT\",\"muted\":false}").statusCode());
            assertEquals(0,first.json(first.get("/api/notifications/preferences/"+workspace)).size());

        } finally {jdbc.execute("TRUNCATE users,workspaces CASCADE");}
    }
}
