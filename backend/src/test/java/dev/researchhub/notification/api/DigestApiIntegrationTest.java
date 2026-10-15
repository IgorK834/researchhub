package dev.researchhub.notification.api;

import dev.researchhub.notification.application.*;
import dev.researchhub.notification.infrastructure.PostgresDigests;
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
import static org.mockito.Mockito.*;

@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT,properties={"researchhub.notifications.dispatcher.enabled=false","researchhub.processing.dispatcher.enabled=false"})
@ActiveProfiles("local") @Import({PostgresTestcontainersConfiguration.class,DigestApiIntegrationTest.TimeFixture.class})
class DigestApiIntegrationTest {
    @Value("${local.server.port}") int port;
    @Autowired ObjectMapper json; @Autowired JdbcTemplate jdbc; @Autowired DigestService digests; @Autowired PostgresDigests store;
    @org.springframework.boot.test.context.TestConfiguration(proxyBeanMethods=false)
    static class TimeFixture {
        @org.springframework.context.annotation.Bean @org.springframework.context.annotation.Primary
        MutableClock digestClock(){return new MutableClock();}
    }
    static class MutableClock extends Clock {
        volatile Instant current=Instant.parse("2026-10-15T12:00:00Z");
        public Instant instant(){return current;}
        public ZoneId getZone(){return ZoneOffset.UTC;}
        public Clock withZone(ZoneId zone){return Clock.fixed(current,zone);}
    }
    @Autowired MutableClock clock;
    @org.springframework.test.context.bean.override.mockito.MockitoBean dev.researchhub.analysis.application.ProblemPlanner problemPlanner;
    @org.springframework.test.context.bean.override.mockito.MockitoBean dev.researchhub.analysis.application.AnalysisPlanner datasetPlanner;
    ApiBrowser owner,member,outsider;UUID workspace,user;Instant now;String route="/api/notifications/digests";
    @BeforeEach void setup() throws Exception {
        jdbc.execute("TRUNCATE users,workspaces CASCADE");
        now=Instant.parse("2026-10-15T12:00:00Z");clock.current=now;
        owner=new ApiBrowser(port,json);member=new ApiBrowser(port,json);outsider=new ApiBrowser(port,json);
        owner.signUp("digest-owner@test.invalid","Owner");user=UUID.fromString(member.signUp("digest-member@test.invalid","Member"));outsider.signUp("digest-outsider@test.invalid","Outsider");
        workspace=UUID.fromString(owner.createdWorkspaceId("Digest lab","Private content"));
        assertEquals(201,owner.postJson("/api/workspaces/"+workspace+"/members","{\"email\":\"digest-member@test.invalid\",\"role\":\"EDITOR\"}").statusCode());
    }
    @AfterEach void clean(){verifyNoInteractions(problemPlanner,datasetPlanner);jdbc.execute("TRUNCATE users,workspaces CASCADE");}
    void event(Instant time) {
        jdbc.update("INSERT INTO product_audit_events(id,workspace_id,event_type,resource_type,resource_id,metadata,created_at) VALUES(?,?,'COMMENT_CREATED','COMMENT',?,?::jsonb,?)",UUID.randomUUID(),workspace,UUID.randomUUID(),json.writeValueAsString(Map.of("documentId",UUID.randomUUID())),java.sql.Timestamp.from(time));
    }
    JsonNode feed(ApiBrowser browser) throws Exception {var r=browser.get(route);assertEquals(200,r.statusCode(),r.body());assertEquals("no-store",r.headers().firstValue("Cache-Control").orElseThrow());return browser.json(r);}
    void settings(String frequency,String categories) throws Exception {var r=member.sendWithMethod("PUT",route+"/preferences/"+workspace,"{\"frequency\":\""+frequency+"\",\"mutedCategories\":"+categories+"}");assertEquals(204,r.statusCode(),r.body());}
    @Test void dailyAndWeeklyAreExactlyOnceAcrossConcurrentRetryAndCursorIsDurable() throws Exception {
        event(now.minus(Duration.ofDays(10)));event(now.minus(Duration.ofDays(10)).plusSeconds(1));
        event(now.minus(Duration.ofDays(9)));event(now.minusSeconds(1));
        try(var pool=Executors.newFixedThreadPool(2)){var a=pool.submit(digests::dispatch);var b=pool.submit(digests::dispatch);a.get();b.get();}
        int count=jdbc.queryForObject("SELECT count(*) FROM notification_digests",Integer.class);digests.dispatch();assertEquals(count,jdbc.queryForObject("SELECT count(*) FROM notification_digests",Integer.class));
        var daily=feed(member);assertEquals(4,daily.path("sinceLastSeen").get(0).path("count").asInt());assertEquals(2,daily.path("digests").size());
        assertEquals(2,daily.path("digests").get(1).path("items").get(0).path("count").asInt());
        assertFalse(daily.toString().contains("Private content"));assertFalse(daily.toString().contains("prompt"));
        assertEquals(204,member.postJson(route+"/seen",json.writeValueAsString(Map.of("through",daily.path("through").asString()))).statusCode());assertEquals(0,feed(member).path("sinceLastSeen").size());
        // The same account in a new session reads the persisted cursor/preferences.
        var reloaded=new ApiBrowser(port,json);assertEquals(200,reloaded.postJson("/api/auth/login","{\"email\":\"digest-member@test.invalid\",\"password\":\"correct-horse-battery-staple\"}").statusCode());assertEquals(0,feed(reloaded).path("sinceLastSeen").size());
        settings("WEEKLY","[]");var weekly=feed(member);assertTrue(weekly.path("digests").size()>=1);assertEquals("WEEKLY",weekly.path("digests").get(0).path("frequency").asString());
        assertEquals("WEEKLY",reloaded.json(reloaded.get(route+"/preferences")).get(0).path("settings").path("frequency").asString());
        assertEquals(400,member.postJson(route+"/seen","{\"through\":\"2099-01-01T00:00:00Z\"}").statusCode());assertEquals(400,member.postJson(route+"/seen","{}").statusCode());
        assertEquals(403,member.sendWithoutCsrf("POST",route+"/seen","{}").statusCode());
        assertEquals(401,new ApiBrowser(port,json).get(route).statusCode());assertEquals(0,feed(outsider).path("digests").size());
    }
    @Test void muteRetentionRestoreAndRevocationAreAppliedAtPublicationAndRead() throws Exception {
        event(now.minus(Duration.ofDays(3)));event(now.minus(Duration.ofDays(40)));digests.dispatch();
        assertEquals(1,feed(member).path("sinceLastSeen").get(0).path("count").asInt());
        settings("DAILY","[\"COMMENT\"]");assertEquals(0,feed(member).path("digests").size());assertEquals(0,feed(member).path("sinceLastSeen").size());
        settings("MUTED","[]");event(now.minus(Duration.ofDays(2)));digests.dispatch();assertEquals(0,feed(member).path("digests").size());
        settings("DAILY","[]");digests.dispatch();assertEquals(2,feed(member).path("sinceLastSeen").get(0).path("count").asInt());
        clock.current=now.plus(Duration.ofDays(40));digests.dispatch();assertEquals(0,feed(member).path("digests").size());assertEquals(0,jdbc.queryForObject("SELECT count(*) FROM notification_digests",Integer.class));
        clock.current=now;digests.dispatch();assertEquals(204,owner.delete("/api/workspaces/"+workspace+"/members/"+user).statusCode());
        assertEquals(0,feed(member).path("sinceLastSeen").size());assertEquals(0,feed(member).path("digests").size());assertEquals(0,jdbc.queryForObject("SELECT count(*) FROM notification_digests WHERE user_id=?",Integer.class,user));
        assertEquals(404,member.sendWithMethod("PUT",route+"/preferences/"+workspace,"{\"frequency\":\"DAILY\",\"mutedCategories\":[]}").statusCode());
        assertEquals(400,owner.sendWithMethod("PUT",route+"/preferences/"+workspace,"{\"frequency\":\"OTHER\",\"mutedCategories\":[]}").statusCode());
    }
    @Test void publicationBatchCannotStarveLaterWindows() {
        for(int i=0;i<8;i++){UUID account=UUID.randomUUID();String email="batch"+i+"@test.invalid";
            jdbc.update("INSERT INTO users(id,email,normalized_email,password_hash,display_name,status,created_at,updated_at) VALUES(?,?,?,'!','Batch','ACTIVE',now(),now())",account,email,email);
            jdbc.update("INSERT INTO workspace_members VALUES(?,?,?,'VIEWER',now())",UUID.randomUUID(),workspace,account);
        }
        for(int i=1;i<=25;i++)event(now.minus(Duration.ofDays(i)));
        for(int i=0;i<4;i++)digests.dispatch();
        assertEquals(250,jdbc.queryForObject("SELECT count(*) FROM notification_digests WHERE frequency='DAILY'",Integer.class));
        assertEquals(25,jdbc.queryForObject("SELECT count(*) FROM notification_digests WHERE user_id=? AND frequency='DAILY'",Integer.class,user));
    }
    @Test void weeklyRetentionExcludesExpiredEventsEvenInsideRetainedWindow() throws Exception {
        event(now.minus(Duration.ofDays(31)));event(now.minus(Duration.ofDays(29)));settings("WEEKLY","[]");digests.dispatch();
        var result=feed(member);assertEquals(1,result.path("sinceLastSeen").get(0).path("count").asInt());
        assertEquals(1,result.path("digests").size());assertEquals(1,result.path("digests").get(0).path("items").get(0).path("count").asInt());
    }

}
