package dev.researchhub.notification.api;

import dev.researchhub.notification.application.NotificationDispatcher;
import dev.researchhub.shared.infrastructure.persistence.PostgresTestcontainersConfiguration;
import dev.researchhub.support.ApiBrowser;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.*;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import tools.jackson.databind.*;
import java.time.*;
import java.util.*;
import java.util.concurrent.*;
import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT,properties="researchhub.notifications.dispatcher.enabled=false")
@ActiveProfiles("local")
@Import(PostgresTestcontainersConfiguration.class)
class CollaborationWorkflowApiIntegrationTest {
    @Value("${local.server.port}") int port;
    @Autowired ObjectMapper json;
    @Autowired JdbcTemplate jdbc;
    @Autowired NotificationDispatcher dispatcher;
    ApiBrowser owner,member,viewer,outsider;
    String workspace,document,route,taskRoute,ownerId,memberId,viewerId,outsiderId;
    UUID anchor,comment;
    @BeforeEach void setup() throws Exception {
        clean();owner=new ApiBrowser(port,json);member=new ApiBrowser(port,json);viewer=new ApiBrowser(port,json);outsider=new ApiBrowser(port,json);
        ownerId=owner.signUp("owner@workflow.test","Owner");memberId=member.signUp("member@workflow.test","Member");
        viewerId=viewer.signUp("viewer@workflow.test","Viewer");outsiderId=outsider.signUp("outsider@workflow.test","Outsider");
        workspace=owner.createdWorkspaceId("Private workspace","Private description");
        add("member@workflow.test","EDITOR");add("viewer@workflow.test","VIEWER");
        anchor=UUID.randomUUID();comment=UUID.randomUUID();
        String content="{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"text\":\"Evidence\",\"marks\":[{\"type\":\"commentAnchor\",\"attrs\":{\"ids\":[\""+anchor+"\"]}}]}]}]}";
        var created=owner.postJson("/api/workspaces/"+workspace+"/documents",json.writeValueAsString(Map.of("title","Secret report","content",json.readTree(content))));
        assertEquals(201,created.statusCode(),created.body());document=owner.json(created).path("id").asString();
        route="/api/workspaces/"+workspace+"/documents/"+document+"/comments";taskRoute="/api/workspaces/"+workspace+"/review-tasks";
    }
    @AfterEach void clean() {jdbc.execute("TRUNCATE users,workspaces,workspace_members,documents CASCADE");}
    void add(String email,String role) throws Exception {assertEquals(201,owner.postJson("/api/workspaces/"+workspace+"/members",json.writeValueAsString(Map.of("email",email,"role",role))).statusCode());}
    String encoded(Object value) {return json.writeValueAsString(value);}
    Map<String,Object> mention(String user,String label,int start) {return Map.of("userId",user,"displayLabel",label,"start",start,"end",start+label.length()+1);}
    Map<String,Object> commentBody(String body,List<?> mentions) {return Map.of("id",comment,"body",body,"anchor",Map.of("strategy","TEXT_MARK_V1","id",anchor,"quote","Evidence"),"mentions",mentions);}
    void createComment(String body,List<?> mentions) throws Exception {var response=owner.postJson(route,encoded(commentBody(body,mentions)));assertEquals(201,response.statusCode(),response.body());}
    JsonNode feed(ApiBrowser browser) throws Exception {var response=browser.get("/api/notifications");assertEquals(200,response.statusCode(),response.body());return browser.json(response);}
    JsonNode createTask(String user) throws Exception {
        var body=new LinkedHashMap<String,Object>();body.put("id",UUID.randomUUID());body.put("title","Review evidence");body.put("description","Plain description");body.put("targetType","COMMENT");body.put("targetId",comment);body.put("documentId",document);body.put("assignee",user);body.put("dueAt","2026-01-01T00:00:00Z");
        var response=owner.postJson(taskRoute,encoded(body));assertEquals(201,response.statusCode(),response.body());return owner.json(response);
    }
    Map<String,Object> update(JsonNode task,String status,String assignee) {
        var body=new LinkedHashMap<String,Object>();body.put("revision",task.path("revision").asLong());body.put("title",task.path("title").asString());body.put("description",task.path("description").asString());body.put("status",status);body.put("assignee",assignee);body.put("dueAt",task.path("dueAt").isNull() ? null : task.path("dueAt").asString());return body;
    }
    @Test void mentionFanoutRetryReadAndReloadAreUserScopedAndConcurrent() throws Exception {
        createComment("Please @Member review @ai",List.of(mention(memberId,"Member",7)));
        assertEquals(201,owner.postJson(route,encoded(commentBody("Please @Member review @ai",List.of(mention(memberId,"Member",7))))).statusCode());
        dispatcher.dispatchAvailable();
        // Simulate recovery/replay of an acknowledged job and simultaneous processes.
        jdbc.update("UPDATE notification_outbox SET delivered_at=NULL,available_at=now()");
        try(var pool=Executors.newFixedThreadPool(2)) {
            var first=pool.submit(dispatcher::dispatchAvailable);var second=pool.submit(dispatcher::dispatchAvailable);first.get();second.get();
        }
        var memberFeed=feed(member);assertEquals(1,memberFeed.path("unreadCount").asInt());assertEquals("MENTION",memberFeed.path("items").get(0).path("type").asString());
        String notification=memberFeed.path("items").get(0).path("id").asString();
        assertTrue(memberFeed.path("items").get(0).path("href").asString().endsWith("#comment-"+comment));
        assertEquals("COMMENT",feed(viewer).path("items").get(0).path("type").asString());assertEquals(0,feed(owner).path("unreadCount").asInt());
        assertEquals("Private workspace",memberFeed.path("items").get(0).path("workspaceLabel").asString());
        assertEquals("Secret report",memberFeed.path("items").get(0).path("targetLabel").asString());
        String response=memberFeed.toString();for(String secret:List.of("Please","@ai","workflow.test"))assertFalse(response.contains(secret));
        assertEquals(404,outsider.postJson("/api/notifications/"+notification+"/read","{}").statusCode());
        assertEquals(403,member.sendWithoutCsrf("POST","/api/notifications/"+notification+"/read","{}").statusCode());
        try(var pool=Executors.newFixedThreadPool(2)) {
            var a=pool.submit(()->member.postJson("/api/notifications/"+notification+"/read","{}"));var b=pool.submit(()->member.postJson("/api/notifications/"+notification+"/read","{}"));
            assertEquals(204,a.get().statusCode());assertEquals(204,b.get().statusCode());
        }
        assertEquals(0,feed(member).path("unreadCount").asInt());assertFalse(feed(member).path("items").get(0).path("readAt").isNull());
        assertEquals(0,member.json(member.get("/api/notifications?unread=true")).path("items").size());
        assertEquals(401,new ApiBrowser(port,json).get("/api/notifications").statusCode());
        assertEquals(0,jdbc.queryForObject("SELECT count(*) FROM comment_ai_suggestions",Integer.class));
    }
    @Test void validatesMentionsUpdatesAndSuppressesRemovedMentionsBeforeDelivery() throws Exception {
        assertEquals(400,owner.postJson(route,encoded(commentBody("@Outsider",List.of(mention(outsiderId,"Outsider",0))))).statusCode());
        assertEquals(400,owner.postJson(route,encoded(commentBody("@Member",List.of(mention(memberId,"Member",1))))).statusCode());
        assertEquals(400,owner.postJson(route,encoded(commentBody("@Member",List.of(mention(memberId,"Impostor",0))))).statusCode());
        createComment("@Member",List.of(mention(memberId,"Member",0)));
        String edit=route+"/"+comment+"/body";
        assertEquals(403,member.sendWithMethod("PUT",edit,encoded(Map.of("revision",1,"body","@Member","mentions",List.of(mention(memberId,"Member",0))))).statusCode());
        var changed=owner.sendWithMethod("PUT",edit,encoded(Map.of("revision",1,"body","No mention now","mentions",List.of())));assertEquals(200,changed.statusCode(),changed.body());
        dispatcher.dispatchAvailable();assertEquals(0,feed(member).path("unreadCount").asInt());
        assertEquals(409,owner.sendWithMethod("PUT",edit,encoded(Map.of("revision",1,"body","stale"))).statusCode());
        var add=owner.sendWithMethod("PUT",edit,encoded(Map.of("revision",2,"body","Again @Member","mentions",List.of(mention(memberId,"Member",6)))));assertEquals(200,add.statusCode(),add.body());
        var noop=owner.sendWithMethod("PUT",edit,encoded(Map.of("revision",3,"body","Again @Member","mentions",List.of(mention(memberId,"Member",6)))));assertEquals(200,noop.statusCode());assertEquals(3,owner.json(noop).path("revision").asInt());
        var textOnly=owner.sendWithMethod("PUT",edit,encoded(Map.of("revision",3,"body","Again @Member please","mentions",List.of(mention(memberId,"Member",6)))));assertEquals(200,textOnly.statusCode());
        dispatcher.dispatchAvailable();assertEquals(1,feed(member).path("unreadCount").asInt());
        assertEquals(3,owner.json(owner.get(route+"/"+comment)).path("events").size()-1);
        assertEquals(204,owner.delete("/api/workspaces/"+workspace+"/members/"+memberId).statusCode());
        assertEquals(400,owner.sendWithMethod("PUT",edit,encoded(Map.of("revision",4,"body","@Member","mentions",List.of(mention(memberId,"Member",0))))).statusCode());
        assertFalse(owner.json(owner.get(route)).get(0).path("mentions").get(0).path("available").asBoolean());
    }
    @Test void workspaceDirectoryIsBoundedAndNeverListsEmailsOrForeignAccounts() throws Exception {
        String people="/api/workspaces/"+workspace+"/people";
        var data=member.json(member.get(people+"?q=Member"));assertEquals(1,data.size());assertEquals(memberId,data.get(0).path("userId").asString());assertFalse(data.toString().contains("email"));
        assertEquals(0,owner.json(owner.get(people+"?q=Outsider")).size());assertEquals(404,outsider.get(people).statusCode());
        assertEquals(400,owner.get(people+"?q="+"x".repeat(81)).statusCode());
        for(int i=0;i<12;i++) {UUID id=UUID.randomUUID();jdbc.update("INSERT INTO users(id,email,normalized_email,password_hash,display_name,status,created_at,updated_at) VALUES(?,?,?,'!','Current','ACTIVE',now(),now())",id,"bounded"+i+"@test.invalid","bounded"+i+"@test.invalid");jdbc.update("INSERT INTO workspace_members VALUES(?,?,?,'EDITOR',now())",UUID.randomUUID(),UUID.fromString(workspace),id);}
        assertEquals(10,owner.json(owner.get(people)).size());
    }
    @Test void revokedMembershipPurgesOldContentAndRejoiningDoesNotReviveIt() throws Exception {
        createComment("@Member",List.of(mention(memberId,"Member",0)));dispatcher.dispatchAvailable();
        String notification=feed(member).path("items").get(0).path("id").asString();var task=createTask(memberId);
        assertEquals(204,owner.delete("/api/workspaces/"+workspace+"/members/"+memberId).statusCode());dispatcher.dispatchAvailable();
        assertEquals(0,feed(member).path("items").size());assertEquals(404,member.get(route).statusCode());assertEquals(404,member.get(taskRoute+"/"+task.path("id").asString()).statusCode());
        assertEquals(404,member.postJson("/api/notifications/"+notification+"/read","{}").statusCode());
        var unassigned=owner.json(owner.get(taskRoute)).path("items").get(0);assertTrue(unassigned.path("assignee").isNull());assertEquals("MEMBER_REMOVED",unassigned.path("unassignedReason").asString());assertEquals(2,unassigned.path("revision").asInt());
        add("member@workflow.test","EDITOR");dispatcher.dispatchAvailable();assertEquals(0,feed(member).path("items").size());
        UUID reply=UUID.randomUUID();assertEquals(201,owner.postJson(route+"/"+comment+"/replies",encoded(Map.of("id",reply,"body","Next reply"))).statusCode());dispatcher.dispatchAvailable();assertEquals(1,feed(member).path("items").size());
    }
    @Test void mutePreferencesRetryFailureAndRetentionRemainDurable() throws Exception {
        String preferences="/api/notifications/preferences/"+workspace;
        assertEquals(204,member.sendWithMethod("PUT",preferences,"{\"type\":\"MENTION\",\"muted\":true}").statusCode());
        assertTrue(member.json(member.get(preferences)).get(0).path("muted").asBoolean());assertEquals(404,outsider.get(preferences).statusCode());
        createComment("@Member",List.of(mention(memberId,"Member",0)));dispatcher.dispatchAvailable();assertEquals(0,feed(member).path("items").size());
        assertEquals(204,member.sendWithMethod("PUT",preferences,"{\"type\":\"MENTION\",\"muted\":false}").statusCode());
        assertEquals(201,owner.postJson(route+"/"+comment+"/replies",encoded(Map.of("id",UUID.randomUUID(),"body","@Member","mentions",List.of(mention(memberId,"Member",0))))).statusCode());
        jdbc.execute("CREATE FUNCTION fail_notification_delivery() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'delivery failure'; END $$");
        try {
            jdbc.execute("CREATE TRIGGER fail_notification_delivery BEFORE INSERT ON notifications FOR EACH ROW EXECUTE FUNCTION fail_notification_delivery()");dispatcher.dispatchAvailable();
            assertTrue(jdbc.queryForObject("SELECT count(*) FROM notification_outbox WHERE attempts>0 AND delivered_at IS NULL",Integer.class)>0);
        } finally {jdbc.execute("DROP TRIGGER IF EXISTS fail_notification_delivery ON notifications");jdbc.execute("DROP FUNCTION fail_notification_delivery()");}
        jdbc.update("UPDATE notification_outbox SET available_at=now() WHERE delivered_at IS NULL");dispatcher.dispatchAvailable();assertEquals(1,feed(member).path("items").size());
        jdbc.update("UPDATE notifications SET created_at=now()-interval '91 days'");jdbc.update("UPDATE notification_outbox SET created_at=now()-interval '91 days'");
        assertEquals(0,feed(member).path("items").size());dispatcher.cleanup();assertEquals(0,jdbc.queryForObject("SELECT count(*) FROM notifications",Integer.class));
        assertEquals(0,jdbc.queryForObject("SELECT count(*) FROM notification_outbox",Integer.class));dispatcher.scheduledDispatch();
    }
    @Test void cursorTypeAndMarkAllBoundariesDoNotCrossUsersOrReadFutureRows() throws Exception {
        createComment("Review",List.of());
        for(int i=0;i<3;i++)assertEquals(201,owner.postJson(route+"/"+comment+"/replies",encoded(Map.of("id",UUID.randomUUID(),"body","Reply"))).statusCode());
        dispatcher.dispatchAvailable();var first=member.json(member.get("/api/notifications?limit=2"));assertEquals(2,first.path("items").size());String cursor=first.path("nextCursor").asString();
        var second=member.json(member.get("/api/notifications?limit=2&cursor="+cursor));assertEquals(2,second.path("items").size());assertTrue(second.path("nextCursor").isNull());
        assertEquals(400,viewer.get("/api/notifications?cursor="+cursor).statusCode());assertEquals(400,member.get("/api/notifications?unread=true&cursor="+cursor).statusCode());
        assertEquals(400,member.get("/api/notifications?cursor=invalid").statusCode());assertEquals(400,member.get("/api/notifications?limit=51").statusCode());assertEquals(400,member.get("/api/notifications?limit=0").statusCode());
        assertEquals(0,member.json(member.get("/api/notifications?type=MENTION")).path("items").size());
        String boundary=first.path("items").get(0).path("createdAt").asString();
        var marked=member.postJson("/api/notifications/read-all",encoded(Map.of("before",boundary,"limit",2)));assertEquals(200,marked.statusCode());assertEquals(2,member.json(marked).path("updated").asInt());
        assertEquals(2,feed(member).path("unreadCount").asInt());assertEquals(4,feed(viewer).path("unreadCount").asInt());
        assertEquals(400,member.postJson("/api/notifications/read-all",encoded(Map.of("before","2999-01-01T00:00:00Z","limit",100))).statusCode());
        assertEquals(400,member.postJson("/api/notifications/read-all",encoded(Map.of("before",boundary,"limit",101))).statusCode());
    }
    @Test void taskWorkflowMineFiltersAuditAndOptimisticConcurrency() throws Exception {
        createComment("Review",List.of());JsonNode task=createTask(memberId);String path=taskRoute+"/"+task.path("id").asString();
        assertEquals(1,member.json(member.get(taskRoute+"?filter=MINE")).path("items").size());assertEquals(0,owner.json(owner.get(taskRoute+"?filter=MINE")).path("items").size());
        assertEquals(1,owner.json(owner.get(taskRoute+"?filter=OPEN")).path("items").size());assertEquals(1,owner.json(owner.get(taskRoute+"?filter=OVERDUE")).path("items").size());
        assertEquals(403,viewer.patchJson(path,encoded(update(task,"DONE",memberId))).statusCode());assertEquals(404,outsider.get(path).statusCode());
        assertEquals(404,outsider.postJson(taskRoute,"{}").statusCode());assertEquals(400,owner.get(taskRoute+"?limit=0").statusCode());assertEquals(400,owner.get(taskRoute+"?limit=51").statusCode());
        String payload=encoded(update(task,"IN_PROGRESS",memberId));
        try(var pool=Executors.newFixedThreadPool(2)) {
            var start=new CountDownLatch(1);var a=pool.submit(()->{start.await();return owner.patchJson(path,payload);});var b=pool.submit(()->{start.await();return member.patchJson(path,payload);});start.countDown();
            assertEquals(Set.of(200,409),Set.of(a.get().statusCode(),b.get().statusCode()));
        }
        var current=member.json(member.get(path));assertEquals(200,member.patchJson(path,encoded(update(current,"DONE",memberId))).statusCode());
        assertEquals(0,member.json(member.get(taskRoute+"?filter=OPEN")).path("items").size());assertEquals(0,member.json(member.get(taskRoute+"?filter=OVERDUE")).path("items").size());
        current=owner.json(owner.get(path));assertEquals(409,owner.patchJson(path,encoded(update(current,"CANCELLED",memberId))).statusCode());
        assertEquals(200,owner.patchJson(path,encoded(update(current,"OPEN",memberId))).statusCode());
        current=owner.json(owner.get(path));var due=update(current,"OPEN",memberId);due.put("dueAt","2027-01-01T10:00:00+02:00");assertEquals(200,owner.patchJson(path,encoded(due)).statusCode());
        assertEquals("2027-01-01T08:00:00Z",owner.json(owner.get(path)).path("dueAt").asString());
        dispatcher.dispatchAvailable();assertEquals(2,member.json(member.get("/api/notifications?type=REVIEW_TASK")).path("items").size());
        assertEquals(5,jdbc.queryForObject("SELECT count(*) FROM product_audit_events WHERE resource_type='REVIEW_TASK'",Integer.class));
    }
    @Test void tasksValidateTargetsAssigneesQuotaAndIdempotentCreation() throws Exception {
        createComment("Review",List.of());var task=createTask(memberId);String path=taskRoute+"/"+task.path("id").asString();
        assertEquals(400,owner.patchJson(path,encoded(update(task,"OPEN",outsiderId))).statusCode());
        assertEquals(200,owner.patchJson(path,encoded(update(task,"OPEN",memberId))).statusCode());assertEquals(1,owner.json(owner.get(path)).path("revision").asInt());
        var body=new LinkedHashMap<String,Object>();body.put("id",task.path("id").asString());body.put("title","Review evidence");body.put("description","Plain description");body.put("targetType","COMMENT");body.put("targetId",comment);body.put("documentId",document);body.put("assignee",memberId);body.put("dueAt","2026-01-01T00:00:00Z");
        assertEquals(201,owner.postJson(taskRoute,encoded(body)).statusCode());body.put("title","Changed");assertEquals(409,owner.postJson(taskRoute,encoded(body)).statusCode());
        body.put("id",UUID.randomUUID());body.put("targetId",UUID.randomUUID());assertEquals(404,owner.postJson(taskRoute,encoded(body)).statusCode());body.put("targetId",comment);body.put("title"," ");assertEquals(400,owner.postJson(taskRoute,encoded(body)).statusCode());body.put("title","x".repeat(201));assertEquals(400,owner.postJson(taskRoute,encoded(body)).statusCode());
        body.put("title","Valid");body.remove("documentId");assertEquals(400,owner.postJson(taskRoute,encoded(body)).statusCode());
        body.put("targetType","DOCUMENT");body.put("targetId",document);body.remove("assignee");body.remove("dueAt");assertEquals(201,owner.postJson(taskRoute,encoded(body)).statusCode());
        var page=owner.json(owner.get(taskRoute+"?limit=1"));assertFalse(page.path("nextCursor").isNull());assertEquals(1,owner.json(owner.get(taskRoute+"?cursor="+page.path("nextCursor").asString())).path("items").size());
        assertEquals(404,owner.get(taskRoute+"?cursor="+UUID.randomUUID()).statusCode());
        jdbc.update("INSERT INTO review_tasks(id,workspace_id,title,description,target_type,target_id,status,revision,created_by,created_at,updated_at) SELECT gen_random_uuid(),?,'Bounded','','DOCUMENT',?,'OPEN',1,?,now(),now() FROM generate_series(1,498)",UUID.fromString(workspace),UUID.fromString(document),UUID.fromString(ownerId));
        body.put("id",UUID.randomUUID());assertEquals(409,owner.postJson(taskRoute,encoded(body)).statusCode());
        assertEquals(200,owner.postJson("/api/workspaces/"+workspace+"/archive","{}").statusCode());assertEquals(409,owner.patchJson(path,encoded(update(task,"OPEN",memberId))).statusCode());
    }
    @Test void analysisEventsTargetsAndAttentionAreProjectedWithoutPrivatePrompts() throws Exception {
        UUID analysis=UUID.randomUUID(),report=UUID.randomUUID(),parent=UUID.randomUUID();
        jdbc.update("INSERT INTO analyses(id,workspace_id,created_by,user_prompt,status,inputs,created_at,updated_at) VALUES(?,?,?,'Private prompt','DRAFT','[{\"sourceId\":\"frozen\"}]',now(),now())",analysis,UUID.fromString(workspace),UUID.fromString(ownerId));
        for(String status:List.of("SUCCEEDED","FAILED"))jdbc.update("INSERT INTO product_audit_events(id,workspace_id,actor_user_id,event_type,resource_type,resource_id,metadata,created_at) VALUES(?,?,?,'ANALYSIS_EXECUTED','ANALYSIS_EXECUTION',?,?::jsonb,now())",UUID.randomUUID(),UUID.fromString(workspace),UUID.fromString(ownerId),UUID.randomUUID(),encoded(Map.of("analysisId",analysis,"status",status)));
        dispatcher.dispatchAvailable();assertEquals(2,feed(owner).path("items").size());assertFalse(feed(owner).toString().contains("Private prompt"));
        assertTrue(feed(owner).path("items").get(0).path("href").asString().endsWith("/analyses/"+analysis));
        var body=new LinkedHashMap<String,Object>();body.put("id",UUID.randomUUID());body.put("title","Review result");body.put("description","");body.put("targetType","ANALYSIS");body.put("targetId",analysis);body.put("assignee",memberId);
        assertEquals(201,owner.postJson(taskRoute,encoded(body)).statusCode());
        jdbc.update("INSERT INTO ai_source_analyses VALUES(?,?,?,'COMPARISON',NULL,'{}',now())",parent,UUID.fromString(workspace),UUID.fromString(ownerId));
        jdbc.update("INSERT INTO ai_source_analyses VALUES(?,?,?,'DISAGREEMENTS',?,?::jsonb,now())",report,UUID.fromString(workspace),UUID.fromString(ownerId),parent,encoded(Map.of("answer",Map.of("findings",List.of(Map.of("description","Historical finding"))))));
        body.put("id",UUID.randomUUID());body.put("targetType","EVIDENCE_FINDING");body.put("targetId",report);body.put("findingIndex",0);
        var evidence=owner.postJson(taskRoute,encoded(body));assertEquals(201,evidence.statusCode(),evidence.body());assertTrue(owner.json(evidence).path("href").asString().contains("#evidence-finding-"+report+"-0"));
        body.put("id",UUID.randomUUID());body.put("findingIndex",1);assertEquals(404,owner.postJson(taskRoute,encoded(body)).statusCode());
        body.put("findingIndex",5);assertEquals(400,owner.postJson(taskRoute,encoded(body)).statusCode());
        assertEquals(200,owner.patchJson("/api/workspaces/"+workspace+"/members/"+memberId,"{\"role\":\"VIEWER\"}").statusCode());dispatcher.dispatchAvailable();
        assertEquals(1,member.json(member.get("/api/notifications?type=ATTENTION")).path("items").size());
        // A corrupt/cross-workspace target is hidden before revealing the task title, even to a member.
        jdbc.update("UPDATE review_tasks SET target_id=? WHERE id=?",UUID.randomUUID(),UUID.fromString(owner.json(evidence).path("id").asString()));
        assertEquals(404,owner.get(taskRoute+"/"+owner.json(evidence).path("id").asString()).statusCode());
        assertEquals(1,owner.json(owner.get(taskRoute)).path("items").size());
        assertEquals(1,member.json(member.get("/api/notifications?type=REVIEW_TASK")).path("items").size());
    }
    @Test void taskContractRejectsMissingFieldsAndMalformedUpdates() throws Exception {
        createComment("Review",List.of());var task=createTask(memberId);String path=taskRoute+"/"+task.path("id").asString();
        var valid=new LinkedHashMap<String,Object>();valid.put("id",UUID.randomUUID());valid.put("title","Review");valid.put("description","");valid.put("targetType","DOCUMENT");valid.put("targetId",document);
        for(String key:List.of("id","targetType","targetId","title","description")) {var missing=new LinkedHashMap<>(valid);missing.remove(key);assertEquals(400,owner.postJson(taskRoute,encoded(missing)).statusCode(),key);}
        for(String title:List.of(""," ","title\ncontrol")) {valid.put("title",title);assertEquals(400,owner.postJson(taskRoute,encoded(valid)).statusCode());}
        valid.put("title","Review");valid.put("description","x".repeat(4001));assertEquals(400,owner.postJson(taskRoute,encoded(valid)).statusCode());
        valid.put("description","");valid.put("findingIndex",0);assertEquals(400,owner.postJson(taskRoute,encoded(valid)).statusCode());valid.remove("findingIndex");valid.put("documentId",document);assertEquals(400,owner.postJson(taskRoute,encoded(valid)).statusCode());
        var changed=update(task,"OPEN",memberId);changed.put("title","Changed title");assertEquals(200,owner.patchJson(path,encoded(changed)).statusCode());
        task=owner.json(owner.get(path));changed=update(task,"OPEN",null);changed.put("description","Changed description");assertEquals(200,owner.patchJson(path,encoded(changed)).statusCode());
        task=owner.json(owner.get(path));changed=update(task,"OPEN",null);changed.remove("status");assertEquals(409,owner.patchJson(path,encoded(changed)).statusCode());
        assertEquals(400,owner.get("/api/workspaces/"+workspace+"/people?q=%0A").statusCode());
    }
    @Test @org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable(named="COLLABORATION_WORKFLOW_BROWSER_TESTS",matches="true")
    void productionBrowserCompletesMentionNotificationAndReviewTaskFlows() throws Exception {
        var builder=new ProcessBuilder("node","e2e/collaboration-workflow.cjs").directory(java.nio.file.Path.of("../frontend").toFile());
        builder.environment().put("E2E_BACKEND_URL","http://127.0.0.1:"+port);builder.environment().put("E2E_WORKSPACE_ID",workspace);builder.environment().put("E2E_DOCUMENT_ID",document);
        builder.environment().put("E2E_MEMBER_ID",memberId);
        var log=java.nio.file.Path.of("target/collaboration-workflow-browser.log");var process=builder.redirectErrorStream(true).redirectOutput(log.toFile()).start();
        long deadline=System.nanoTime()+Duration.ofSeconds(55).toNanos();
        while(process.isAlive()&&System.nanoTime()<deadline) {dispatcher.dispatchAvailable();Thread.sleep(150);}
        if(process.isAlive()) {process.destroyForcibly();fail("Workflow browser exceeded deadline: "+log);}
        assertEquals(0,process.exitValue(),java.nio.file.Files.readString(log));
        assertEquals(1,jdbc.queryForObject("SELECT count(*) FROM review_tasks WHERE status='DONE'",Integer.class));
        assertEquals(0,jdbc.queryForObject("SELECT count(*) FROM comment_ai_suggestions",Integer.class));
        assertEquals(0,jdbc.queryForObject("SELECT count(*) FROM ai_generation_runs WHERE workspace_id=?",Integer.class,UUID.fromString(workspace)));
    }

}
