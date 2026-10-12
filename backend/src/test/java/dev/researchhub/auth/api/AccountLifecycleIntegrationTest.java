package dev.researchhub.auth.api;

import ch.qos.logback.classic.Logger;
import ch.qos.logback.core.read.ListAppender;
import ch.qos.logback.classic.spi.ILoggingEvent;
import dev.researchhub.auth.infrastructure.LoggingMailSender;
import dev.researchhub.security.application.SecureTokens;
import dev.researchhub.support.SessionBrowser;
import dev.researchhub.support.SessionTestApplications;
import org.junit.jupiter.api.*;
import org.slf4j.LoggerFactory;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.jdbc.core.JdbcTemplate;
import org.testcontainers.postgresql.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;
import tools.jackson.databind.*;
import java.net.*;
import java.net.http.*;
import java.util.*;
import java.util.concurrent.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.awaitility.Awaitility.await;
import static java.time.Duration.ofSeconds;
import static dev.researchhub.support.SessionTestApplications.port;

/** Real browsers, two backend replicas, Flyway/PostgreSQL and the actual local logging mail adapter. */
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class AccountLifecycleIntegrationTest {
    final PostgreSQLContainer database=new PostgreSQLContainer(DockerImageName.parse("pgvector/pgvector:0.8.2-pg17-bookworm").asCompatibleSubstituteFor("postgres"));
    ConfigurableApplicationContext a,b;
    final ListAppender<ILoggingEvent> mail=new ListAppender<>();
    @BeforeAll void start() {
        database.start();
        a=SessionTestApplications.start(database,"jdbc");
        b=SessionTestApplications.start(database,"jdbc","--researchhub.auth.registration.mode=invite-only");
        mail.start();((Logger)LoggerFactory.getLogger(LoggingMailSender.class)).addAppender(mail);
    }
    @AfterAll void stop() {
        ((Logger)LoggerFactory.getLogger(LoggingMailSender.class)).detachAppender(mail);
        mail.stop();if(a!=null)a.close();if(b!=null)b.close();database.close();
    }
    @BeforeEach void budgets() { jdbc().update("DELETE FROM security_operation_bucket"); }
    JdbcTemplate jdbc() { return a.getBean(JdbcTemplate.class); }
    JsonNode json(String body) { return a.getBean(ObjectMapper.class).readTree(body); }
    String email() { return UUID.randomUUID()+"@example.test"; }
    String register(SessionBrowser browser,String email) throws Exception {
        var response=browser.register(port(a),email);assertEquals(201,response.statusCode(),response.body());
        assertEquals(200,browser.login(port(a),email).statusCode());return json(response.body()).path("id").asString();
    }
    HttpResponse<String> post(SessionBrowser browser,int replica,String path,String body) throws Exception { return browser.post(replica,path,body,browser.csrf(replica)); }
    String workspace(SessionBrowser browser) throws Exception {
        var response=post(browser,port(a),"/api/workspaces","{\"name\":\"Invitation lab\"}");assertEquals(201,response.statusCode(),response.body());return json(response.body()).path("id").asString();
    }
    JsonNode invite(SessionBrowser owner,String workspace,String email,String role) throws Exception {
        var response=post(owner,port(a),"/api/workspaces/"+workspace+"/invitations","{\"email\":\" "+email.toUpperCase(Locale.ROOT)+" \",\"role\":\""+role+"\"}");
        assertEquals(201,response.statusCode(),response.body());return json(response.body());
    }
    String token(JsonNode invitation) { return invitation.path("invitationPath").asString().split("#")[1]; }
    String id(JsonNode invitation) { return invitation.path("invitation").path("id").asString(); }
    String delivered(String path,int before) {
        await().atMost(ofSeconds(10)).until(() -> mail.list.size()>before && mail.list.stream().skip(before).anyMatch(e -> e.getFormattedMessage().contains(path+"#")));
        return mail.list.stream().skip(before).filter(e -> e.getFormattedMessage().contains(path+"#")).findFirst().orElseThrow().getFormattedMessage().split("#")[1];
    }
    void verify(SessionBrowser browser) throws Exception {
        assertEquals(200,browser.get(port(a),"/api/auth/email-verification").statusCode());
        int before=mail.list.size();assertEquals(202,post(browser,port(a),"/api/auth/email-verification/request","").statusCode());
        String token=delivered("/verify-email",before);
        assertEquals(204,post(browser,port(b),"/api/auth/email-verification/complete","{\"token\":\""+token+"\"}").statusCode());
        assertEquals(400,post(browser,port(a),"/api/auth/email-verification/complete","{\"token\":\""+token+"\"}").statusCode());
    }
    HttpResponse<String> delete(SessionBrowser browser,int replica,String path) throws Exception {
        try(var client=HttpClient.newHttpClient()) {
            return client.send(HttpRequest.newBuilder(URI.create("http://localhost:"+replica+path)).DELETE()
                .header("Cookie","JSESSIONID="+browser.cookie("JSESSIONID")+"; XSRF-TOKEN="+browser.csrf(replica))
                .header("X-XSRF-TOKEN",browser.cookie("XSRF-TOKEN")).build(),HttpResponse.BodyHandlers.ofString());
        }
    }
    @Test void inviteOnlyRegistrationVerificationAcceptanceAndRoleAreEndToEnd() throws Exception {
        try(var owner=new SessionBrowser();var newcomer=new SessionBrowser();var wrong=new SessionBrowser()) {
            String ownerId=register(owner,email()),ws=workspace(owner),address=email();
            var invitation=invite(owner,ws,address,"EDITOR");String token=token(invitation);
            assertTrue(SecureTokens.valid(token));
            assertEquals(SecureTokens.hash(token),jdbc().queryForObject("SELECT token_hash FROM workspace_invitation WHERE id=?",String.class,UUID.fromString(id(invitation))));
            assertEquals(7L*86400,jdbc().queryForObject("SELECT extract(epoch FROM expires_at-created_at)::bigint FROM workspace_invitation WHERE id=?",Long.class,UUID.fromString(id(invitation))));
            assertEquals(403,newcomer.register(port(b),address).statusCode());
            String registration="{\"email\":\""+address+"\",\"password\":\""+SessionBrowser.PASSWORD+"\",\"displayName\":\"New researcher\",\"invitationToken\":\""+token+"\"}";
            assertEquals(201,post(newcomer,port(b),"/api/auth/register",registration).statusCode());
            assertEquals(200,newcomer.login(port(b),address).statusCode());
            assertEquals(403,post(newcomer,port(a),"/api/invitations/"+token+"/accept","").statusCode());
            register(wrong,email());verify(wrong);
            assertEquals(400,post(wrong,port(a),"/api/invitations/"+token+"/accept","").statusCode());
            verify(newcomer);
            assertEquals(200,post(newcomer,port(b),"/api/invitations/"+token+"/accept","").statusCode());
            var visible=newcomer.get(port(a),"/api/workspaces/"+ws);assertEquals(200,visible.statusCode());assertEquals("EDITOR",json(visible.body()).path("role").asString());
            assertEquals(400,post(newcomer,port(a),"/api/invitations/"+token+"/accept","").statusCode());
            assertEquals(403,newcomer.get(port(a),"/api/workspaces/"+ws+"/invitations").statusCode());
            var listed=owner.get(port(a),"/api/workspaces/"+ws+"/invitations");assertEquals(200,listed.statusCode());assertFalse(listed.body().contains(token));assertFalse(listed.body().contains("tokenHash"));
            assertEquals(2,jdbc().queryForObject("SELECT count(*) FROM product_audit_events WHERE workspace_id=? AND event_type LIKE 'INVITATION_%'",Integer.class,UUID.fromString(ws)));
            assertNotNull(ownerId);
        }
    }
    @Test void invitationErrorsAuthorizationRevocationExpiryAndRegistrationMismatch() throws Exception {
        try(var owner=new SessionBrowser();var foreign=new SessionBrowser();var invited=new SessionBrowser()) {
            register(owner,email());register(foreign,email());String address=email();register(invited,address);verify(invited);String ws=workspace(owner);
            assertEquals(404,foreign.get(port(a),"/api/workspaces/"+ws+"/invitations").statusCode());
            assertEquals(404,post(foreign,port(a),"/api/workspaces/"+ws+"/invitations","{\"email\":\"x@example.test\",\"role\":\"OWNER\"}").statusCode());
            var revoked=invite(owner,ws,address,"VIEWER");
            assertEquals(404,delete(foreign,port(a),"/api/workspaces/"+ws+"/invitations/"+id(revoked)).statusCode());
            assertEquals(204,delete(owner,port(b),"/api/workspaces/"+ws+"/invitations/"+id(revoked)).statusCode());
            assertEquals(204,delete(owner,port(a),"/api/workspaces/"+ws+"/invitations/"+id(revoked)).statusCode());
            var bad=post(invited,port(a),"/api/invitations/"+token(revoked)+"/accept","");assertEquals(400,bad.statusCode());assertEquals("VALIDATION_FAILED",json(bad.body()).path("code").asString());assertFalse(bad.body().contains(token(revoked)));
            var expired=invite(owner,ws,address,"VIEWER");jdbc().update("UPDATE workspace_invitation SET created_at=now()-interval '8 days',expires_at=now()-interval '1 day' WHERE id=?",UUID.fromString(id(expired)));
            assertEquals(400,post(invited,port(a),"/api/invitations/"+token(expired)+"/accept","").statusCode());
            assertEquals(400,post(invited,port(a),"/api/invitations/invalid/accept","").statusCode());
            var other=invite(owner,ws,email(),"OWNER");
            assertEquals(403,post(foreign,port(b),"/api/auth/register","{\"email\":\""+email()+"\",\"displayName\":\"No\",\"password\":\""+SessionBrowser.PASSWORD+"\",\"invitationToken\":\""+token(other)+"\"}").statusCode());
            assertEquals(404,delete(owner,port(a),"/api/workspaces/"+ws+"/invitations/"+UUID.randomUUID()).statusCode());
        }
    }
    @Test void passwordChangeAndSessionRevocationWorkAcrossReplicasWithoutLeakingIds() throws Exception {
        try(var one=new SessionBrowser();var two=new SessionBrowser();var stranger=new SessionBrowser()) {
            String address=email(),user=register(one,address);assertEquals(200,two.login(port(b),address).statusCode());register(stranger,email());
            assertEquals(403,one.get(port(a),"/api/auth/sessions").statusCode());
            var list=one.getWithCsrf(port(a),"/api/auth/sessions");assertEquals(200,list.statusCode(),list.body());var sessions=json(list.body());assertEquals(2,sessions.size());
            for(var row:sessions) { assertTrue(SecureTokens.valid(row.path("handle").asString()));assertFalse(row.has("id"));assertTrue(row.has("createdAt"));assertTrue(row.has("lastAccessedAt"));assertTrue(row.has("userAgent")); }
            var rawIds=jdbc().queryForList("SELECT session_id FROM spring_session WHERE principal_name=?",String.class,user);
            for(String raw:rawIds) assertFalse(list.body().contains(raw));
            String handle=sessions.get(0).path("handle").asString();assertEquals(404,delete(stranger,port(a),"/api/auth/sessions/"+handle).statusCode());
            String otherHandle="";for(var row:sessions) if(!row.path("current").asBoolean())otherHandle=row.path("handle").asString();
            assertEquals(204,delete(one,port(a),"/api/auth/sessions/"+otherHandle).statusCode());assertEquals(401,two.get(port(b),"/api/me").statusCode());
            assertEquals(200,two.login(port(b),address).statusCode());
            String body="{\"currentPassword\":\""+SessionBrowser.PASSWORD+"\",\"newPassword\":\"replacement-password-strong\"}";
            assertEquals(403,one.post(port(a),"/api/auth/password",body,null).statusCode());
            assertEquals(401,post(one,port(a),"/api/auth/password",body.replace(SessionBrowser.PASSWORD,"wrong-password")).statusCode());
            assertEquals(400,post(one,port(a),"/api/auth/password",body.replace("replacement-password-strong","short")).statusCode());
            assertEquals(204,post(one,port(a),"/api/auth/password",body).statusCode());assertEquals(200,one.get(port(b),"/api/me").statusCode());assertEquals(401,two.get(port(a),"/api/me").statusCode());
            assertEquals(401,two.login(port(a),address).statusCode());
            assertEquals(204,post(one,port(b),"/api/auth/sessions/revoke-all","").statusCode());assertEquals(401,one.get(port(a),"/api/me").statusCode());
            assertEquals(4,jdbc().queryForObject("SELECT count(*) FROM account_audit_events WHERE user_id=?",Integer.class,UUID.fromString(user)));
        }
    }
    @Test void resetUsesLoggingMailUniformRequestsAndInvalidatesEverySession() throws Exception {
        try(var one=new SessionBrowser();var two=new SessionBrowser();var anonymous=new SessionBrowser()) {
            String address=email(),user=register(one,address);two.login(port(b),address);int before=mail.list.size();
            var known=post(anonymous,port(a),"/api/auth/password-reset/request","{\"email\":\""+address+"\"}");
            var unknown=post(anonymous,port(b),"/api/auth/password-reset/request","{\"email\":\""+email()+"\"}");
            assertEquals(202,known.statusCode());assertEquals(known.statusCode(),unknown.statusCode());assertEquals(known.body(),unknown.body());
            String token=delivered("/reset-password",before);
            int secondBefore=mail.list.size();post(anonymous,port(a),"/api/auth/password-reset/request","{\"email\":\""+address+"\"}");String secondToken=delivered("/reset-password",secondBefore);
            assertEquals(1800L,jdbc().queryForObject("SELECT extract(epoch FROM expires_at-created_at)::bigint FROM account_lifecycle_token WHERE token_hash=?",Long.class,SecureTokens.hash(token)));
            String body="{\"token\":\""+token+"\",\"newPassword\":\"reset-password-strong-enough\"}";
            assertEquals(400,post(anonymous,port(a),"/api/auth/password-reset/complete",body.replace("reset-password-strong-enough","short")).statusCode());
            assertEquals(204,post(anonymous,port(b),"/api/auth/password-reset/complete",body).statusCode());
            assertEquals(401,one.get(port(a),"/api/me").statusCode());assertEquals(401,two.get(port(b),"/api/me").statusCode());
            assertEquals(400,post(anonymous,port(a),"/api/auth/password-reset/complete",body).statusCode());
            assertEquals(400,post(anonymous,port(a),"/api/auth/password-reset/complete",body.replace(token,secondToken)).statusCode());
            assertEquals(200,post(anonymous,port(a),"/api/auth/login","{\"email\":\""+address+"\",\"password\":\"reset-password-strong-enough\"}").statusCode());
            assertEquals(1,jdbc().queryForObject("SELECT count(*) FROM account_audit_events WHERE user_id=? AND event_type='PASSWORD_RESET'",Integer.class,UUID.fromString(user)));
        }
    }
    @Test void twoConcurrentAcceptancesConsumeTheInvitationExactlyOnceAndCurrentSessionCanBeRevoked() throws Exception {
        try(var owner=new SessionBrowser();var one=new SessionBrowser();var two=new SessionBrowser()) {
            register(owner,email());String address=email();register(one,address);two.login(port(b),address);verify(one);String ws=workspace(owner);
            var invitation=invite(owner,ws,address,"OWNER");String token=token(invitation);String csrfOne=one.csrf(port(a)),csrfTwo=two.csrf(port(b));
            try(var executor=Executors.newVirtualThreadPerTaskExecutor()) {
                var start=new CountDownLatch(1);
                var first=executor.submit(() -> {start.await();return one.post(port(a),"/api/invitations/"+token+"/accept","",csrfOne).statusCode();});
                var second=executor.submit(() -> {start.await();return two.post(port(b),"/api/invitations/"+token+"/accept","",csrfTwo).statusCode();});
                start.countDown();assertEquals(Set.of(200,400),Set.of(first.get(15,TimeUnit.SECONDS),second.get(15,TimeUnit.SECONDS)));
            }
            assertEquals(409,delete(owner,port(a),"/api/workspaces/"+ws+"/invitations/"+id(invitation)).statusCode());
            var sessions=json(one.getWithCsrf(port(a),"/api/auth/sessions").body());String handle="";for(var session:sessions)if(session.path("current").asBoolean())handle=session.path("handle").asString();
            assertEquals(204,delete(one,port(b),"/api/auth/sessions/"+handle).statusCode());assertEquals(401,one.get(port(a),"/api/me").statusCode());assertEquals(200,two.get(port(b),"/api/me").statusCode());
        }
    }
    @Test void archivedWorkspaceAndExpiredResetCannotBeUsed() throws Exception {
        try(var owner=new SessionBrowser();var recipient=new SessionBrowser();var anon=new SessionBrowser()) {
            register(owner,email());String address=email();register(recipient,address);verify(recipient);String ws=workspace(owner);var invitation=invite(owner,ws,address,"VIEWER");
            assertEquals(200,post(owner,port(a),"/api/workspaces/"+ws+"/archive","").statusCode());
            assertEquals(409,post(recipient,port(b),"/api/invitations/"+token(invitation)+"/accept","").statusCode());
            int before=mail.list.size();post(anon,port(a),"/api/auth/password-reset/request","{\"email\":\""+address+"\"}");String token=delivered("/reset-password",before);
            jdbc().update("UPDATE account_lifecycle_token SET created_at=now()-interval '1 hour',expires_at=now()-interval '1 minute' WHERE token_hash=?",SecureTokens.hash(token));
            assertEquals(400,post(anon,port(b),"/api/auth/password-reset/complete","{\"token\":\""+token+"\",\"newPassword\":\"replacement-password-long\"}").statusCode());
            assertEquals(200,recipient.get(port(a),"/api/me").statusCode());
        }
    }
    @Test void invitationAndResetBudgetsAreSharedAndCsrfIsRequired() throws Exception {
        try(var owner=new SessionBrowser();var anon=new SessionBrowser()) {
            register(owner,email());String ws=workspace(owner);
            for(int i=0;i<10;i++)invite(owner,ws,email(),"VIEWER");
            var limited=post(owner,port(b),"/api/workspaces/"+ws+"/invitations","{\"email\":\"x@example.test\",\"role\":\"VIEWER\"}");assertEquals(429,limited.statusCode());assertTrue(limited.headers().firstValue("Retry-After").isPresent());
            assertEquals(403,anon.post(port(a),"/api/auth/password-reset/request","{\"email\":\"x@example.test\"}",null).statusCode());
            for(int i=0;i<10;i++)assertEquals(202,post(anon,i%2==0?port(a):port(b),"/api/auth/password-reset/request","{\"email\":\""+email()+"\"}").statusCode());
            assertEquals(429,post(anon,port(b),"/api/auth/password-reset/request","{\"email\":\""+email()+"\"}").statusCode());
        }
    }
}
