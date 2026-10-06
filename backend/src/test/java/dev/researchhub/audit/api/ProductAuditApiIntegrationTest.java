package dev.researchhub.audit.api;

import dev.researchhub.shared.infrastructure.persistence.PostgresTestcontainersConfiguration;
import dev.researchhub.source.SourceRowFixture;
import dev.researchhub.support.ApiBrowser;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.*;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.*;
import tools.jackson.databind.ObjectMapper;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT)
@ActiveProfiles("local")
@TestPropertySource(properties="researchhub.processing.dispatcher.enabled=false")
@Import(PostgresTestcontainersConfiguration.class)
class ProductAuditApiIntegrationTest {
    @Value("${local.server.port}") int port;
    @Autowired ObjectMapper json;
    @Autowired JdbcTemplate jdbc;
    ApiBrowser owner, viewer, outsider;
    String workspace, ownerId, viewerId, path;
    @BeforeEach void setup() throws Exception {
        jdbc.execute("TRUNCATE users,workspaces CASCADE");
        owner=new ApiBrowser(port,json); viewer=new ApiBrowser(port,json); outsider=new ApiBrowser(port,json);
        ownerId=owner.signUp("owner@audit.test","Owner"); viewerId=viewer.signUp("viewer@audit.test","Viewer"); outsider.signUp("outsider@audit.test","Outsider");
        workspace=owner.createdWorkspaceId("Private title","Private description"); path="/api/workspaces/"+workspace+"/audit-events";
        assertEquals(201,owner.postJson("/api/workspaces/"+workspace+"/members","{\"email\":\"viewer@audit.test\",\"role\":\"VIEWER\"}").statusCode());
    }
    @AfterEach void cleanup() { jdbc.execute("TRUNCATE users,workspaces CASCADE"); }
    @Test void representativeWorkspaceMemberDocumentAndSourceActionsHaveSafeImmutableEvents() throws Exception {
        String members="/api/workspaces/"+workspace+"/members/"+viewerId;
        assertEquals(200,owner.patchJson(members,"{\"role\":\"EDITOR\"}").statusCode());
        assertEquals(200,owner.patchJson(members,"{\"role\":\"EDITOR\"}").statusCode());
        assertEquals(201,owner.postJson("/api/workspaces/"+workspace+"/documents","{\"title\":\"Secret report\",\"content\":{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"text\":\"Secret full content\"}]}]}}").statusCode());
        UUID source=UUID.randomUUID(); UUID version=SourceRowFixture.insertReadyText(jdbc,source,UUID.fromString(workspace),UUID.fromString(ownerId),"Private source contents");
        assertEquals(202,owner.postJson("/api/workspaces/"+workspace+"/sources/"+source+"/reprocess","{}").statusCode());
        var events=viewer.json(viewer.get(path)).path("events");
        assertEquals(5,events.size());
        var types=new HashSet<String>(); events.forEach(e -> types.add(e.path("eventType").asString()));
        assertEquals(Set.of("WORKSPACE_CREATED","MEMBER_ADDED","MEMBER_ROLE_CHANGED","DOCUMENT_CREATED","SOURCE_REPROCESSED"),types);
        assertFalse(events.toString().contains("Secret")); assertFalse(events.toString().contains("Private"));
        assertFalse(events.toString().contains("@")); assertFalse(events.toString().contains("password"));
        assertEquals(version.toString(),events.get(0).path("metadata").path("sourceVersionId").asString());
        assertEquals(ownerId,events.get(0).path("actorUserId").asString());
        assertThrows(org.springframework.dao.DataAccessException.class,() -> jdbc.update("UPDATE product_audit_events SET metadata='{}'"));
        assertThrows(org.springframework.dao.DataAccessException.class,() -> jdbc.update("DELETE FROM product_audit_events"));
        assertEquals(204,owner.delete(members).statusCode());
        assertEquals(1,jdbc.queryForObject("SELECT count(*) FROM product_audit_events WHERE event_type='MEMBER_REMOVED'",Integer.class));
        assertEquals(404,viewer.get(path).statusCode());
    }
    @Test void scopedPaginationIncludesEveryEventExactlyOnceIncludingEqualTimestamps() throws Exception {
        var timestamp=jdbc.queryForObject("SELECT min(created_at) FROM product_audit_events",java.sql.Timestamp.class);
        // Insert system events at exactly the same instant; UPDATE is deliberately unavailable.
        for (int i=0;i<3;i++) jdbc.update("INSERT INTO product_audit_events VALUES (?,?,NULL,'ANALYSIS_EXECUTED','ANALYSIS_EXECUTION',?,'{}',?)",
                UUID.randomUUID(),UUID.fromString(workspace),UUID.randomUUID(),timestamp);
        Set<String> seen=new HashSet<>(); String next=path+"?limit=2";
        while (next!=null) {
            var response=viewer.get(next); assertEquals(200,response.statusCode(),response.body()); var page=viewer.json(response);
            page.path("events").forEach(event -> assertTrue(seen.add(event.path("id").asString())));
            next=page.path("nextCursor").isNull() ? null : path+"?limit=2&before="+page.path("nextCursor").asString();
        }
        assertEquals(5,seen.size());
        assertEquals(400,viewer.get(path+"?limit=0").statusCode()); assertEquals(400,viewer.get(path+"?limit=101").statusCode());
        assertEquals(404,viewer.get(path+"?before="+UUID.randomUUID()).statusCode());
        String foreign=owner.createdWorkspaceId("Other","Other");
        String foreignCursor=owner.json(owner.get("/api/workspaces/"+foreign+"/audit-events")).path("events").get(0).path("id").asString();
        assertEquals(404,viewer.get(path+"?before="+foreignCursor).statusCode());
        assertEquals(404,outsider.get(path).statusCode()); assertEquals(401,new ApiBrowser(port,json).get(path).statusCode());
    }
    @Test void auditFailureRollsBackTheSignificantAction() throws Exception {
        int before=jdbc.queryForObject("SELECT count(*) FROM documents",Integer.class);
        jdbc.execute("CREATE FUNCTION fail_product_creation_fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_type='DOCUMENT_CREATED' THEN RAISE EXCEPTION 'fixture'; END IF; RETURN NEW; END $$");
        jdbc.execute("CREATE TRIGGER fail_product_creation_fixture BEFORE INSERT ON product_audit_events FOR EACH ROW EXECUTE FUNCTION fail_product_creation_fixture()");
        try {
            assertEquals(500,owner.postJson("/api/workspaces/"+workspace+"/documents","{\"title\":\"Report\",\"content\":{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\"}]}}").statusCode());
            assertEquals(before,jdbc.queryForObject("SELECT count(*) FROM documents",Integer.class));
        } finally { jdbc.execute("DROP TRIGGER fail_product_creation_fixture ON product_audit_events"); jdbc.execute("DROP FUNCTION fail_product_creation_fixture()"); }
    }
}
