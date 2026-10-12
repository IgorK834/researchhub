package dev.researchhub.user.application;

import dev.researchhub.security.application.*;
import dev.researchhub.shared.error.*;
import dev.researchhub.source.application.SourceStorage;
import dev.researchhub.source.domain.StorageKey;
import dev.researchhub.user.infrastructure.PersonalDataInventory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.io.IOException;
import java.sql.Timestamp;
import java.time.*;
import java.util.*;

/** PostgreSQL is the durable job/receipt authority; external object deletion is idempotent. */
@Service
public class AccountErasureService {
    public static final String POLICY="ADR-014/live-erasure-v1";
    public record Accepted(UUID jobId, String receipt, String status, String policyVersion, String backupStatus) {
        @Override public String toString() { return "Accepted[receipt=REDACTED]"; }
    }
    public record Status(UUID jobId,String status,Instant requestedAt,Instant liveErasedAt,int attempts,String errorCode,String backupStatus) {}
    private final JdbcTemplate jdbc;
    private final PasswordEncoder passwords;
    private final SecurityOperationLimiter limiter;
    private final SourceStorage storage;
    private final Clock clock;
    private final org.springframework.beans.factory.ObjectProvider<ErasureLedger> ledgers;
    public AccountErasureService(JdbcTemplate jdbc,PasswordEncoder passwords,SecurityOperationLimiter limiter,SourceStorage storage,Clock clock,org.springframework.beans.factory.ObjectProvider<ErasureLedger> ledgers) {
        this.jdbc=jdbc;this.passwords=passwords;this.limiter=limiter;this.storage=storage;this.clock=clock;this.ledgers=ledgers;
    }
    @Transactional
    public Accepted request(UUID caller,String password) {
        limiter.admit(caller.toString(),SecurityOperationLimiter.Operation.ACCOUNT_ERASURE);
        var rows=jdbc.queryForList("SELECT password_hash,status FROM users WHERE id=? FOR UPDATE",caller);
        if(rows.isEmpty() || !"ACTIVE".equals(rows.getFirst().get("status"))) throw new UnauthenticatedException("Account is unavailable");
        if(password==null || password.getBytes(java.nio.charset.StandardCharsets.UTF_8).length>PasswordPolicy.BCRYPT_MAX_BYTES
            || !passwords.matches(password,(String)rows.getFirst().get("password_hash"))) throw new UnauthenticatedException("Current password is incorrect");
        // Serialize membership changes, including archived workspaces, before deciding the ownership scope.
        var scopes=jdbc.queryForList("SELECT w.id FROM workspaces w JOIN workspace_members m ON m.workspace_id=w.id WHERE m.user_id=? AND m.role='OWNER' ORDER BY w.id FOR UPDATE OF w",UUID.class,caller);
        for(UUID workspace:scopes) if(jdbc.queryForObject("SELECT count(*) FROM workspace_members WHERE workspace_id=? AND user_id<>?",Integer.class,workspace,caller)>0)
            throw new ConflictException("Transfer ownership and leave shared workspaces before deleting your account. A workspace with other members cannot be erased by this request.");
        for(var contribution:PersonalDataInventory.CONTRIBUTIONS.entrySet()) {
            String scope=scopes.isEmpty() ? "TRUE" : "workspace_id NOT IN ("+String.join(",",Collections.nCopies(scopes.size(),"?"))+")";
            var parameters=new ArrayList<Object>();parameters.add(caller);parameters.addAll(scopes);
            if(Boolean.TRUE.equals(jdbc.queryForObject("SELECT EXISTS(SELECT 1 FROM "+contribution.getKey()+" WHERE "+contribution.getValue()+"=? AND "+scope+")",Boolean.class,parameters.toArray())))
                throw new ConflictException("Research contributions remain in a retained workspace. Its owner must resolve the erasure scope before account deletion; collaborators' research cannot be erased by this request.");
        }
        if(Boolean.TRUE.equals(jdbc.queryForObject("SELECT EXISTS(SELECT 1 FROM document_versions v JOIN documents d ON d.id=v.document_id WHERE v.created_by=? AND d.workspace_id NOT IN (SELECT workspace_id FROM workspace_members WHERE user_id=? AND role='OWNER'))",Boolean.class,caller,caller)))
            throw new ConflictException("Document history remains in a retained workspace. Its owner must resolve the erasure scope before account deletion.");
        UUID job=UUID.randomUUID();String receipt=SecureTokens.create();Instant now=clock.instant();
        jdbc.update(connection->{var statement=connection.prepareStatement("INSERT INTO account_erasure_jobs(id,user_id,receipt_hash,policy_version,status,requested_at,next_attempt_at,workspace_ids) VALUES (?,?,?,?,'PENDING',?,?,?)");
            statement.setObject(1,job);statement.setObject(2,caller);statement.setString(3,SecureTokens.hash(receipt));statement.setString(4,POLICY);
            statement.setTimestamp(5,Timestamp.from(now));statement.setTimestamp(6,Timestamp.from(now));statement.setArray(7,connection.createArrayOf("uuid",scopes.toArray()));return statement;});
        for(UUID workspace:scopes) {
            jdbc.update("UPDATE collaboration_documents SET epoch=epoch+1 WHERE document_id IN (SELECT id FROM documents WHERE workspace_id=?)",workspace);
            jdbc.update("UPDATE workspaces SET erasure_requested_at=? WHERE id=?",Timestamp.from(now),workspace);
            jdbc.update("INSERT INTO account_erasure_objects(job_id,storage_key) SELECT ?,storage_key FROM source_versions WHERE workspace_id=? ON CONFLICT DO NOTHING",job,workspace);
            jdbc.update("DELETE FROM collaboration_credentials WHERE workspace_id=?",workspace);
        }
        var sharedMemberships=new ArrayList<Object>(); sharedMemberships.add(caller); sharedMemberships.addAll(scopes);
        jdbc.update("DELETE FROM workspace_members WHERE user_id=?"+(scopes.isEmpty()?"":" AND workspace_id NOT IN ("+String.join(",",Collections.nCopies(scopes.size(),"?"))+")"),sharedMemberships.toArray());
        jdbc.update("UPDATE users SET status='ERASURE_PENDING',updated_at=? WHERE id=?",Timestamp.from(now),caller);
        jdbc.update("DELETE FROM spring_session WHERE principal_name=?",caller.toString());
        jdbc.update("DELETE FROM collaboration_credentials WHERE user_id=?",caller);
        jdbc.update("INSERT INTO account_audit_events VALUES (?,?,'ERASURE_REQUESTED',?)",UUID.randomUUID(),caller,Timestamp.from(now));
        try {
            var ledger=ledgers.getIfAvailable();
            if(ledger==null) throw new IOException("Restore ledger is not configured");
            ledger.record(new ErasureLedger.Entry("1.0",job,caller,List.copyOf(scopes),POLICY,now)); }
        catch(IOException failure) {throw new ConflictException("The erasure restore ledger could not be durably recorded. No deletion was accepted; retry the request.");}
        return new Accepted(job,receipt,"PENDING",POLICY,"OUTSIDE_LIVE_STORE_SCOPE");
    }
    public Status status(UUID job,String receipt) {
        if(!SecureTokens.valid(receipt)) throw new ResourceNotFoundException("Erasure receipt was not found");
        var result=jdbc.query("SELECT id,status,requested_at,live_erased_at,attempts,last_error_code FROM account_erasure_jobs WHERE id=? AND receipt_hash=?",
            (r,i)->new Status(job,r.getString("status"),r.getTimestamp("requested_at").toInstant(),r.getTimestamp("live_erased_at")==null?null:r.getTimestamp("live_erased_at").toInstant(),r.getInt("attempts"),r.getString("last_error_code"),"OUTSIDE_LIVE_STORE_SCOPE"),job,SecureTokens.hash(receipt));
        return result.stream().findFirst().orElseThrow(()->new ResourceNotFoundException("Erasure receipt was not found"));
    }
    /** A row lock spans storage I/O. Crash releases it; deleted objects can safely be retried. */
    @Transactional
    public boolean processNext() {
        var due=jdbc.queryForList("SELECT id FROM account_erasure_jobs WHERE status='PENDING' AND next_attempt_at<=? ORDER BY requested_at FOR UPDATE SKIP LOCKED LIMIT 1",UUID.class,Timestamp.from(clock.instant()));
        if(due.isEmpty())return false;UUID job=due.getFirst();
        jdbc.update("UPDATE account_erasure_jobs SET status='RUNNING',attempts=attempts+1 WHERE id=?",job);
        try {
            var keys=jdbc.queryForList("SELECT storage_key FROM account_erasure_objects WHERE job_id=? ORDER BY storage_key",String.class,job);
            for(String key:keys) {
                if(!Boolean.TRUE.equals(jdbc.queryForObject("SELECT hash_classified FROM account_erasure_objects WHERE job_id=? AND storage_key=?",Boolean.class,job,key))) {
                    boolean retain=classifyHash(job,key);
                    jdbc.update("UPDATE account_erasure_objects SET hash_classified=true,retain_hash=? WHERE job_id=? AND storage_key=?",retain,job,key);
                }
                storage.erase(new StorageKey(key));jdbc.update("UPDATE account_erasure_objects SET deleted_at=? WHERE job_id=? AND storage_key=?",Timestamp.from(clock.instant()),job,key);}
        } catch(IOException | RuntimeException failure) {
            jdbc.update("UPDATE account_erasure_jobs SET status='PENDING',last_error_code='STORAGE_ERASURE_PENDING',next_attempt_at=? WHERE id=?",Timestamp.from(clock.instant().plus(Duration.ofMinutes(1))),job);
            return true;
        }
        jdbc.execute("SELECT finish_account_erasure('"+job+"'::uuid)");
        return true;
    }
    /** Only reviewed plain-text/tabular bytes without identity markers retain a content digest.
     * Binary or unavailable/unclassified inputs keep an erased header with a null hash. */
    private boolean classifyHash(UUID job,String key) throws IOException {
        var rows=jdbc.queryForList("SELECT v.source_type,v.original_filename,u.email,u.normalized_email,u.display_name,u.password_hash FROM source_versions v JOIN account_erasure_jobs j ON j.id=? JOIN users u ON u.id=j.user_id WHERE v.storage_key=?",job,key);
        if(rows.isEmpty())return false;
        var values=rows.getFirst();
        if(!Set.of("TXT","CSV").contains(values.get("source_type")))return false;
        var markers=List.of("email","normalized_email","display_name","password_hash").stream().map(field->((String)values.get(field)).toLowerCase(Locale.ROOT)).filter(value->!value.isBlank()).toList();
        String filename=((String)values.get("original_filename")).toLowerCase(Locale.ROOT);
        if(markers.stream().anyMatch(filename::contains) || !storage.exists(new StorageKey(key)))return false;
        int overlap=markers.stream().mapToInt(String::length).max().orElse(1);String tail="";
        try(var reader=new java.io.InputStreamReader(storage.open(new StorageKey(key)),java.nio.charset.StandardCharsets.UTF_8)) {
            char[] buffer=new char[4096];int read;
            while((read=reader.read(buffer))!=-1) {
                String part=tail+new String(buffer,0,read).toLowerCase(Locale.ROOT);
                if(markers.stream().anyMatch(part::contains))return false;
                tail=part.substring(Math.max(0,part.length()-overlap));
            }
        }
        return true;
    }
}
