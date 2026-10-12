package dev.researchhub.audit.api;

import dev.researchhub.audit.application.AuditExportService;
import dev.researchhub.security.application.*;
import dev.researchhub.shared.infrastructure.persistence.PostgresTestcontainersConfiguration;
import dev.researchhub.support.ApiBrowser;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.*;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.*;
import tools.jackson.databind.ObjectMapper;
import java.io.*;
import java.time.Instant;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT)
@ActiveProfiles("local")
@TestPropertySource(properties={"researchhub.processing.dispatcher.enabled=false","researchhub.security.quotas.store=postgres"})
@Import(PostgresTestcontainersConfiguration.class)
class WorkspaceGovernanceApiIntegrationTest {
    @Value("${local.server.port}") int port;
    @Autowired ObjectMapper json;
    @Autowired JdbcTemplate jdbc;
    @Autowired AuditExportService exports;
    @Autowired CostQuotaStore quotas;
    ApiBrowser owner, editor, viewer, outsider;
    UUID workspace, caller;
    String root;
    @BeforeEach void setup() throws Exception {
        jdbc.execute("TRUNCATE users,workspaces,security_operation_bucket,cost_quota_bucket CASCADE");
        owner=new ApiBrowser(port,json); editor=new ApiBrowser(port,json); viewer=new ApiBrowser(port,json); outsider=new ApiBrowser(port,json);
        caller=UUID.fromString(owner.signUp("owner@governance.test","Secret name"));
        editor.signUp("editor@governance.test","Editor"); viewer.signUp("viewer@governance.test","Viewer"); outsider.signUp("outsider@governance.test","Outsider");
        workspace=UUID.fromString(owner.createdWorkspaceId("Secret title","Secret document text")); root="/api/workspaces/"+workspace;
        owner.postJson(root+"/members","{\"email\":\"editor@governance.test\",\"role\":\"EDITOR\"}");
        owner.postJson(root+"/members","{\"email\":\"viewer@governance.test\",\"role\":\"VIEWER\"}");
    }
    @Test void onlyOwnersCanAccessBothEndpointsAndForeignWorkspacesRemainHidden() throws Exception {
        for (var path:List.of("/audit/export","/ai/usage")) {
            assertEquals(403,editor.get(root+path).statusCode()); assertEquals(403,viewer.get(root+path).statusCode());
            assertEquals(404,outsider.get(root+path).statusCode());
            assertEquals(404,owner.get("/api/workspaces/"+UUID.randomUUID()+path).statusCode());
            assertEquals(401,new ApiBrowser(port,json).get(root+path).statusCode());
        }
        assertEquals(400,owner.get(root+"/audit/export?format=xml").statusCode());
        for (int days:new int[]{0,91}) assertEquals(400,owner.get(root+"/ai/usage?days="+days).statusCode());
    }
    @Test void exportsAcrossPagesAreCompleteSafeAuditedAndRateLimited() throws Exception {
        Instant same=Instant.now().minusSeconds(60);
        for(int i=0;i<405;i++) jdbc.update("INSERT INTO product_audit_events VALUES (?,?,?,'DOCUMENT_CREATED','DOCUMENT',?,'{}',?)",
            UUID.randomUUID(),workspace,caller,UUID.randomUUID(),java.sql.Timestamp.from(same));
        var response=owner.get(root+"/audit/export?format=json"); assertEquals(200,response.statusCode(),response.body());
        var events=json.readTree(response.body()); assertEquals(408,events.size());
        Set<String> ids=new HashSet<>(); events.forEach(row->assertTrue(ids.add(row.path("id").asString())));
        assertFalse(response.body().contains("Secret")); assertFalse(response.body().contains("@governance"));
        assertEquals("private, no-store",response.headers().firstValue("Cache-Control").orElseThrow());
        assertTrue(response.headers().firstValue("Content-Disposition").orElseThrow().contains("attachment"));
        var csv=owner.get(root+"/audit/export?format=csv"); assertEquals(200,csv.statusCode(),csv.body());
        assertTrue(csv.body().startsWith("id,kind,actorId,event,resourceType,resourceId,createdAt\r\n"));
        assertEquals(410,csv.body().lines().count());
        assertEquals(2,jdbc.queryForObject("SELECT count(*) FROM product_audit_events WHERE event_type='AUDIT_EXPORTED'",Integer.class));
        for(int i=0;i<8;i++) assertEquals(200,owner.get(root+"/audit/export").statusCode());
        assertEquals(429,owner.get(root+"/audit/export").statusCode());
        assertThrows(org.springframework.dao.DataAccessException.class,()->jdbc.update("DELETE FROM product_audit_events"));
    }
    @Test void usageHasFailuresUnknownTokensWindowBoundsAndActualQuotaConsumption() throws Exception {
        insertUsage("REWRITE","SUCCEEDED",30L,12L,Instant.now().minusSeconds(30));
        insertUsage("REWRITE","FAILED",null,null,Instant.now().minusSeconds(30));
        insertUsage("SOURCE_ANALYSIS","FAILED",null,null,Instant.now().minusSeconds(30));
        insertUsage("REWRITE","SUCCEEDED",999L,999L,Instant.now().minusSeconds(91*86400L));
        insertUsage("REWRITE","SUCCEEDED",999L,999L,Instant.now().plusSeconds(60));
        quotas.admit(caller,workspace,CostCategory.LLM,new QuotaPolicy(20,60,java.time.Duration.ofMinutes(1)));
        var response=owner.get(root+"/ai/usage?days=7"); assertEquals(200,response.statusCode(),response.body());
        var body=json.readTree(response.body()); var rewrite=body.path("features").get(0);
        assertEquals(2,rewrite.path("requests").asLong()); assertEquals(1,rewrite.path("failures").asLong());
        assertEquals(1,rewrite.path("usageKnown").asLong()); assertEquals(30,rewrite.path("inputTokens").asLong());
        assertTrue(body.path("features").get(1).path("inputTokens").isNull());
        assertEquals(1,body.path("quotas").get(0).path("requests").asInt()); assertEquals(60,body.path("quotas").get(0).path("limit").asInt());
        assertFalse(response.body().contains("prompt")); assertFalse(response.body().contains("Secret"));
    }
    @Test void interruptedOutputAndRevokedMembershipDoNotContinueStreaming() {
        var ticket=exports.prepare(workspace,caller,"json");
        assertThrows(IOException.class,()->exports.stream(ticket,new OutputStream(){ public void write(int value) throws IOException {throw new IOException("Disconnected");} }));
        jdbc.update("DELETE FROM workspace_members WHERE workspace_id=? AND user_id=?",workspace,caller);
        assertThrows(dev.researchhub.shared.error.ResourceNotFoundException.class,()->exports.stream(ticket,new ByteArrayOutputStream()));
    }
    private void insertUsage(String feature,String status,Long inputs,Long outputs,Instant at) {
        jdbc.update("INSERT INTO ai_usage_events(request_id,workspace_id,feature,template_id,status,input_tokens,output_tokens,usage_estimated,latency_ms,started_at,details) VALUES (?,?,?,'fixture-v1',?,?,?,?,1,?,?::jsonb)",
            UUID.randomUUID(),workspace,feature,status,inputs,outputs,inputs==null ? null : false,java.sql.Timestamp.from(at),"{\"prompt\":\"Secret prompt\",\"answer\":\"Secret document text\"}");
    }
}
