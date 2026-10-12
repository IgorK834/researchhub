package dev.researchhub.user.api;

import dev.researchhub.user.application.*;
import dev.researchhub.user.infrastructure.PersonalDataInventory;
import dev.researchhub.source.application.InMemorySourceStorage;
import dev.researchhub.source.domain.StorageKey;
import dev.researchhub.shared.infrastructure.persistence.PostgresTestcontainersConfiguration;
import dev.researchhub.support.ApiBrowser;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.*;
import org.springframework.boot.test.context.*;
import org.springframework.context.annotation.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.*;
import tools.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT)
@ActiveProfiles("local")
@TestPropertySource(properties={"researchhub.processing.dispatcher.enabled=false","researchhub.account.erasure.dispatcher.enabled=false"})
@Import({PostgresTestcontainersConfiguration.class,AccountDataApiIntegrationTest.Storage.class})
class AccountDataApiIntegrationTest {
 @TestConfiguration static class Storage {
  @Bean @Primary InMemorySourceStorage erasureStorage(){return new InMemorySourceStorage();}
  @Bean @Primary ErasureLedger erasureLedger(){return org.mockito.Mockito.mock(ErasureLedger.class);}
 }
 @Value("${local.server.port}") int port;
 @Autowired JdbcTemplate jdbc; @Autowired ObjectMapper json; @Autowired AccountErasureService erasure; @Autowired InMemorySourceStorage storage; @Autowired ErasureLedger ledger; @Autowired UserLookupService lookup;
 ApiBrowser owner,other; UUID caller,workspace; String root;
 static final String EMAIL="rh338-private-883@example.test",NAME="RH338 Private Identity 883",PASSWORD="correct-horse-battery-staple";
 @BeforeEach void setup() throws Exception {
  jdbc.execute("TRUNCATE users,workspaces,security_operation_bucket CASCADE");storage.clear();org.mockito.Mockito.reset(ledger);
  owner=new ApiBrowser(port,json);other=new ApiBrowser(port,json);caller=UUID.fromString(owner.signUp(EMAIL,NAME));other.signUp("other-erasure@example.test","Other");
  workspace=UUID.fromString(owner.createdWorkspaceId(NAME,EMAIL));root="/api/workspaces/"+workspace;
 }
 @Test void erasesAllClassifiedTablesBlobsAndOldVersionsWhileKeepingPseudonymousReceipts() throws Exception {
  var upload=owner.postFile(root+"/sources",NAME+".txt","text/plain",(NAME+" "+EMAIL).getBytes(StandardCharsets.UTF_8));assertEquals(201,upload.statusCode(),upload.body());
  String source=owner.json(upload).path("id").asString();
  jdbc.update("UPDATE sources SET status='READY' WHERE id=?",UUID.fromString(source));
  jdbc.update("UPDATE source_versions SET status='READY' WHERE source_id=?",UUID.fromString(source));
  jdbc.update("UPDATE processing_jobs SET status='CANCELLED',finished_at=now(),next_attempt_at=NULL WHERE resource_id=?",UUID.fromString(source));
  var replacement=owner.postFile(root+"/sources/"+source+"/versions",EMAIL+".txt","text/plain",(EMAIL+" "+NAME+" replacement").getBytes(StandardCharsets.UTF_8));assertEquals(201,replacement.statusCode(),replacement.body());
  var document=owner.postJson(root+"/documents",json.writeValueAsString(Map.of("title",NAME,"content",Map.of("type","doc","content",List.of(Map.of("type","paragraph","content",List.of(Map.of("type","text","text",EMAIL+" "+NAME))))))));assertEquals(201,document.statusCode(),document.body());
  String hash=jdbc.queryForObject("SELECT password_hash FROM users WHERE id=?",String.class,caller);
  jdbc.update("INSERT INTO account_lifecycle_token VALUES (?,?, 'RESET',?,now()+interval '1 hour',NULL,now())",UUID.randomUUID(),EMAIL,"a".repeat(64));
  jdbc.update("INSERT INTO workspace_invitation VALUES (?,?,?,'VIEWER',?,?,now()+interval '1 hour',NULL,NULL,now())",UUID.randomUUID(),workspace,EMAIL,"b".repeat(64),caller);
  var exported=owner.get("/api/account/export");assertEquals(200,exported.statusCode(),exported.body());assertTrue(exported.body().contains(EMAIL));assertTrue(exported.body().contains(NAME));assertFalse(exported.body().contains(hash));assertFalse(exported.body().contains("token_hash"));assertFalse(exported.body().contains("storage_key"));
  var response=owner.sendWithMethod("DELETE","/api/account",json.writeValueAsString(Map.of("password",PASSWORD)));assertEquals(202,response.statusCode(),response.body());
  var accepted=json.readValue(response.body(),AccountErasureService.Accepted.class);
  assertEquals("PENDING",erasure.status(accepted.jobId(),accepted.receipt()).status());
  assertEquals(401,owner.get("/api/auth/me").statusCode());assertEquals(404,other.get(root+"/sources").statusCode());
  assertThrows(org.springframework.dao.DataAccessException.class,()->jdbc.update("UPDATE documents SET title='late payload' WHERE workspace_id=?",workspace));
  assertThrows(org.springframework.dao.DataAccessException.class,()->jdbc.update("DELETE FROM source_versions WHERE workspace_id=?",workspace));
  assertEquals(2,storage.objectCount());assertTrue(erasure.processNext());assertFalse(erasure.processNext());assertEquals(0,storage.objectCount());
  var completed=erasure.status(accepted.jobId(),accepted.receipt());assertEquals("SUCCEEDED",completed.status());assertNotNull(completed.liveErasedAt());assertEquals("OUTSIDE_LIVE_STORE_SCOPE",completed.backupStatus());
  assertEquals(2,jdbc.queryForObject("SELECT count(*) FROM erased_source_versions WHERE workspace_id=?",Integer.class,workspace));
  assertEquals(2,jdbc.queryForObject("SELECT count(*) FROM erased_source_versions WHERE workspace_id=? AND content_sha256 IS NULL",Integer.class,workspace));
  assertEquals("ERASED",jdbc.queryForObject("SELECT status FROM users WHERE id=?",String.class,caller));
  assertTrue(jdbc.queryForObject("SELECT count(*) FROM product_audit_events WHERE actor_user_id=?",Integer.class,caller)>0);
  assertEquals(1,jdbc.queryForObject("SELECT count(*) FROM account_audit_events WHERE user_id=? AND event_type='LIVE_DATA_ERASED'",Integer.class,caller));
  // Enumerate every application table; any unclassified future table breaks this test.
  var tables=new HashSet<>(jdbc.queryForList("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' AND table_name<>'flyway_schema_history'",String.class));assertEquals(PersonalDataInventory.TABLES,tables);
  for(String table:tables) {var values=jdbc.queryForList("SELECT to_jsonb(t)::text FROM "+table+" t",String.class);for(String value:values)for(String secret:List.of(EMAIL,NAME,hash))assertFalse(value.contains(secret),table+" retains erased identity");}
  for(var table:jdbc.queryForList("SELECT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='workspace_id'",String.class))
   if(!Set.of("product_audit_events","erased_source_versions","erased_review_audit_events").contains(table))assertEquals(0,jdbc.queryForObject("SELECT count(*) FROM "+table+" WHERE workspace_id=?",Integer.class,workspace),table);
  assertThrows(org.springframework.dao.DataAccessException.class,()->jdbc.update("DELETE FROM erased_source_versions"));
  assertFalse(jdbc.queryForObject("SELECT rolcanlogin FROM pg_roles WHERE rolname='researchhub_erasure'",Boolean.class));
  assertEquals(0,jdbc.queryForObject("SELECT count(*) FROM pg_auth_members WHERE roleid=(SELECT oid FROM pg_roles WHERE rolname='researchhub_erasure')",Integer.class));
  assertEquals(404,new ApiBrowser(port,json).get("/api/account/deletions/"+accepted.jobId()).statusCode());
 }
 @Test void storageFailureRemainsDurableBlockedAndRetriesIdempotently() throws Exception {
  var upload=owner.postFile(root+"/sources","private.txt","text/plain",EMAIL.getBytes(StandardCharsets.UTF_8));assertEquals(201,upload.statusCode(),upload.body());
  var accepted=erasure.request(caller,PASSWORD);storage.failDeletes(true);assertTrue(erasure.processNext());
  var pending=erasure.status(accepted.jobId(),accepted.receipt());assertEquals("PENDING",pending.status());assertEquals("STORAGE_ERASURE_PENDING",pending.errorCode());assertNull(pending.liveErasedAt());assertFalse(erasure.processNext());
  storage.failDeletes(false);jdbc.update("UPDATE account_erasure_jobs SET next_attempt_at=now() WHERE id=?",accepted.jobId());assertTrue(erasure.processNext());assertEquals("SUCCEEDED",erasure.status(accepted.jobId(),accepted.receipt()).status());assertEquals(0,storage.objectCount());
 }
 @Test void passwordCsrfSharedOwnershipAndRetainedContributionsAreExplicitlyGuarded() throws Exception {
  assertEquals(403,owner.sendWithoutCsrf("DELETE","/api/account","{\"password\":\""+PASSWORD+"\"}").statusCode());
  assertEquals(401,owner.sendWithMethod("DELETE","/api/account","{\"password\":\"incorrect\"}").statusCode());
  assertEquals(400,owner.sendWithMethod("DELETE","/api/account","{}").statusCode());
  assertEquals(201,owner.postJson(root+"/members","{\"email\":\"other-erasure@example.test\",\"role\":\"EDITOR\"}").statusCode());
  var refused=owner.sendWithMethod("DELETE","/api/account",json.writeValueAsString(Map.of("password",PASSWORD)));assertEquals(409,refused.statusCode());assertTrue(refused.body().contains("Transfer ownership"));assertEquals("ACTIVE",jdbc.queryForObject("SELECT status FROM users WHERE id=?",String.class,caller));
  assertEquals(0,jdbc.queryForObject("SELECT count(*) FROM account_erasure_jobs",Integer.class));
  assertThrows(dev.researchhub.shared.error.ResourceNotFoundException.class,()->erasure.status(UUID.randomUUID(),"invalid"));
  assertThrows(dev.researchhub.shared.error.ResourceNotFoundException.class,()->erasure.status(UUID.randomUUID(),dev.researchhub.security.application.SecureTokens.create()));
 }

 @Test void sharedReadersLoseMembershipImmediatelyAndAuditActorsRemainPseudonymous() throws Exception {
  UUID retained=UUID.fromString(other.createdWorkspaceId("Retained","Shared research"));String path="/api/workspaces/"+retained;
  assertEquals(201,other.postJson(path+"/members",json.writeValueAsString(Map.of("email",EMAIL,"role","VIEWER"))).statusCode());
  jdbc.update("INSERT INTO product_audit_events VALUES (?,?,?,'MEMBER_REMOVED','MEMBER',?,'{}',now())",UUID.randomUUID(),retained,caller,caller);
  var accepted=erasure.request(caller,PASSWORD);
  assertEquals(0,jdbc.queryForObject("SELECT count(*) FROM workspace_members WHERE workspace_id=? AND user_id=?",Integer.class,retained,caller));
  assertEquals("Deleted account",lookup.findAllByIds(List.of(caller)).getFirst().displayName());
  assertEquals("ERASURE_PENDING",lookup.findAllByIds(List.of(caller)).getFirst().status());
  assertFalse(lookup.findAllByIds(List.of(caller)).getFirst().email().contains(EMAIL));
  assertTrue(erasure.processNext());assertEquals("Deleted account",lookup.findAllByIds(List.of(caller)).getFirst().displayName());
  var history=other.get(path+"/audit-events");assertEquals(200,history.statusCode(),history.body());assertTrue(history.body().contains(caller.toString()));assertFalse(history.body().contains(EMAIL));
  var status=java.net.http.HttpClient.newHttpClient().send(java.net.http.HttpRequest.newBuilder(owner.url("/api/account/deletions/"+accepted.jobId())).header("X-Erasure-Receipt",accepted.receipt()).GET().build(),java.net.http.HttpResponse.BodyHandlers.ofString());
  assertEquals(200,status.statusCode(),status.body());assertEquals("SUCCEEDED",json.readTree(status.body()).path("status").asString());
  assertThrows(dev.researchhub.shared.error.UnauthenticatedException.class,()->erasure.request(caller,PASSWORD));
  assertEquals(1,jdbc.queryForObject("SELECT count(*) FROM account_erasure_jobs",Integer.class));
 }
 @Test void exportCannotReadRetainedTeamContentAfterMembershipRemovalAndErasureRefusesItsScope() throws Exception {
  UUID retained=UUID.fromString(other.createdWorkspaceId("Retained","Shared research"));String path="/api/workspaces/"+retained;
  other.postJson(path+"/members",json.writeValueAsString(Map.of("email",EMAIL,"role","EDITOR")));
  assertEquals(201,owner.postJson(path+"/documents","{\"title\":\"Foreign team secret 338\",\"content\":{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"text\":\"Foreign team secret 338\"}]}]}}").statusCode());
  jdbc.update("DELETE FROM workspace_members WHERE workspace_id=? AND user_id=?",retained,caller);
  var exported=owner.get("/api/account/export");assertEquals(200,exported.statusCode(),exported.body());assertFalse(exported.body().contains("Foreign team secret 338"));
  var refusal=assertThrows(dev.researchhub.shared.error.ConflictException.class,()->erasure.request(caller,PASSWORD));assertTrue(refusal.getMessage().contains("retained workspace"));
  assertEquals(0,jdbc.queryForObject("SELECT count(*) FROM account_erasure_jobs",Integer.class));
 }
 @Test void missingExternalAuthorityRollsBackAcceptanceAndTokensRateLimitsNeverRetainEmailDigests() throws Exception {
  org.mockito.Mockito.doThrow(new java.io.IOException("provider secret must not leak")).when(ledger).record(org.mockito.ArgumentMatchers.any());
  var failure=assertThrows(dev.researchhub.shared.error.ConflictException.class,()->erasure.request(caller,PASSWORD));assertFalse(failure.getMessage().contains("provider secret"));
  assertEquals("ACTIVE",jdbc.queryForObject("SELECT status FROM users WHERE id=?",String.class,caller));assertEquals(0,jdbc.queryForObject("SELECT count(*) FROM account_erasure_jobs",Integer.class));
  org.mockito.Mockito.reset(ledger);
  jdbc.update("INSERT INTO security_operation_bucket VALUES (?,'RESET_REQUEST',0,1)",dev.researchhub.security.application.SecureTokens.hash("email:"+EMAIL));
  var accepted=erasure.request(caller,PASSWORD);assertTrue(erasure.processNext());
  assertEquals(0,jdbc.queryForObject("SELECT count(*) FROM security_operation_bucket WHERE subject_hash=?",Integer.class,dev.researchhub.security.application.SecureTokens.hash("email:"+EMAIL)));
  assertEquals("SUCCEEDED",erasure.status(accepted.jobId(),accepted.receipt()).status());
 }
 @Test void offlineRestoreReplaysTheBlobAuthorityBeforeServingTrafficAndReconcilesResurrectedBytes() throws Exception {
  var accepted=erasure.request(caller,PASSWORD);assertTrue(erasure.processNext());
  // Simulate an offline physical restore: restoration does not run normal row-publication triggers.
  jdbc.execute("ALTER TABLE workspaces DISABLE TRIGGER z_workspace_erasure");
  try {jdbc.update("UPDATE workspaces SET erasure_requested_at=NULL,erased_at=NULL,name='Restored private workspace' WHERE id=?",workspace);}
  finally {jdbc.execute("ALTER TABLE workspaces ENABLE TRIGGER z_workspace_erasure");}
  jdbc.update("UPDATE users SET status='ACTIVE',email=?,normalized_email=?,display_name=?,password_hash='restored-hash' WHERE id=?",EMAIL,EMAIL,NAME,caller);
  UUID source=UUID.randomUUID();dev.researchhub.source.SourceRowFixture.insertReadyText(jdbc,source,workspace,caller,"Restored private input");
  storage.store(new StorageKey("sources/"+source),new java.io.ByteArrayInputStream(EMAIL.getBytes(StandardCharsets.UTF_8)),"text/plain");
  for(int i=0;i<2;i++)jdbc.execute("SELECT replay_account_erasure('"+accepted.jobId()+"'::uuid,'"+caller+"'::uuid,ARRAY['"+workspace+"'::uuid],now())");
  assertEquals("ERASURE_PENDING",jdbc.queryForObject("SELECT status FROM users WHERE id=?",String.class,caller));
  assertTrue(erasure.processNext());assertEquals(0,storage.objectCount());assertEquals("ERASED",jdbc.queryForObject("SELECT status FROM users WHERE id=?",String.class,caller));
  assertEquals(1,jdbc.queryForObject("SELECT count(*) FROM account_erasure_jobs",Integer.class));
 }
}
