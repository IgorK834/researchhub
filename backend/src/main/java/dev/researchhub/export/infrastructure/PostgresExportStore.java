package dev.researchhub.export.infrastructure;

import dev.researchhub.export.application.*;
import dev.researchhub.export.domain.*;
import dev.researchhub.shared.error.*;
import java.sql.*;
import java.time.Instant;
import java.util.*;
import org.springframework.context.annotation.Profile;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.ObjectMapper;

@Repository
@Profile("local")
public class PostgresExportStore implements ExportStore {
    private final JdbcTemplate jdbc;
    private final ObjectMapper json;
    public PostgresExportStore(JdbcTemplate jdbc,ObjectMapper json) { this.jdbc=jdbc;this.json=json; }
    @Transactional(propagation=org.springframework.transaction.annotation.Propagation.REQUIRES_NEW,
        isolation=org.springframework.transaction.annotation.Isolation.READ_COMMITTED)
    public ExportJob enqueue(ExportJob job,Report report) {
        jdbc.queryForObject("SELECT id FROM workspaces WHERE id=? FOR UPDATE",UUID.class,job.workspaceId());
        Integer count=jdbc.queryForObject("SELECT count(*) FROM report_exports WHERE workspace_id=? AND status IN ('QUEUED','RUNNING')",Integer.class,job.workspaceId());
        if (count!=null && count>=4) throw new ConflictException("This workspace already has four pending exports; wait for one to finish");
        jdbc.update("""
            INSERT INTO report_exports(id,workspace_id,document_id,requested_by,revision,format,status,filename,warnings,
                snapshot,created_at,expires_at) VALUES (?,?,?,?,?,?,'QUEUED',?,?::jsonb,?::jsonb,?,?)
            """,job.id(),job.workspaceId(),job.documentId(),job.requestedBy(),job.revision(),job.format().name(),job.filename(),
            json.writeValueAsString(job.warnings()),json.writeValueAsString(report),Timestamp.from(job.createdAt()),Timestamp.from(job.expiresAt()));
        return job;
    }
    public ExportJob find(UUID workspace,UUID document,UUID job) {
        var result=jdbc.query("SELECT * FROM report_exports WHERE workspace_id=? AND document_id=? AND id=?",this::job,workspace,document,job);
        if (result.isEmpty()) throw new ResourceNotFoundException("Export was not found");return result.getFirst();
    }
    public Report report(UUID workspace,UUID document,UUID job) {
        var found=find(workspace,document,job);requireAvailable(found);
        return jdbc.queryForObject("SELECT snapshot FROM report_exports WHERE workspace_id=? AND document_id=? AND id=?",
            (row,index) -> { String snapshot=row.getString(1);if (snapshot==null) throw new ConflictException("Export has expired");return json.readValue(snapshot,Report.class); },workspace,document,job);
    }
    public ExportJob.Download download(UUID workspace,UUID document,UUID job) {
        var found=find(workspace,document,job);requireAvailable(found);
        if (found.status()!=ExportJob.Status.SUCCEEDED) throw new ConflictException("Export is not ready to download");
        byte[] bytes=jdbc.queryForObject("SELECT content FROM report_exports WHERE workspace_id=? AND document_id=? AND id=?",byte[].class,workspace,document,job);
        if (bytes==null) throw new ConflictException("Export has expired");
        return new ExportJob.Download(found,bytes);
    }
    @Transactional
    public Optional<ExportJob.Claimed> claim(Instant now) {
        var queued=jdbc.query("""
            SELECT * FROM report_exports WHERE status='QUEUED' AND expires_at>? ORDER BY created_at,id
                LIMIT 1 FOR UPDATE SKIP LOCKED
            """,this::job,Timestamp.from(now));
        if (queued.isEmpty()) return Optional.empty();
        var old=queued.getFirst();
        jdbc.update("UPDATE report_exports SET status='RUNNING',started_at=? WHERE id=?",Timestamp.from(now),old.id());
        return Optional.of(new ExportJob.Claimed(find(old.workspaceId(),old.documentId(),old.id()),report(old.workspaceId(),old.documentId(),old.id())));
    }
    @Transactional
    public void complete(UUID job,byte[] bytes,String failure,Instant now) {
        String sha=bytes==null ? null : dev.researchhub.analysis.application.ExecutionOutputValidator.sha256(bytes);
        jdbc.update("""
            UPDATE report_exports SET status=?,content=?,failure_code=?,sha256=?,size_bytes=?,finished_at=?
                WHERE id=? AND status='RUNNING'
            """,failure==null ? "SUCCEEDED" : "FAILED",bytes,failure,sha,bytes==null ? 0 : bytes.length,Timestamp.from(now),job);
    }
    @Transactional
    public void maintain(Instant before,Instant now) {
        jdbc.update("""
            UPDATE report_exports SET status='FAILED',failure_code='RENDER_INTERRUPTED',finished_at=?
                WHERE status='RUNNING' AND started_at<?
            """,Timestamp.from(now),Timestamp.from(before));
        jdbc.update("""
            UPDATE report_exports SET status='EXPIRED',snapshot=NULL,content=NULL,
                finished_at=coalesce(finished_at,?) WHERE status<>'EXPIRED' AND expires_at<=?
            """,Timestamp.from(now),Timestamp.from(now));
    }
    private void requireAvailable(ExportJob job) {
        if (job.status()==ExportJob.Status.EXPIRED) throw new ConflictException("Export has expired; generate it again");
    }
    private ExportJob job(ResultSet row,int index) throws SQLException {
        List<String> warnings=Arrays.asList(json.readValue(row.getString("warnings"),String[].class));
        return new ExportJob(row.getObject("id",UUID.class),row.getObject("workspace_id",UUID.class),row.getObject("document_id",UUID.class),
            row.getObject("requested_by",UUID.class),row.getLong("revision"),ExportFormat.valueOf(row.getString("format")),
            ExportJob.Status.valueOf(row.getString("status")),row.getString("filename"),warnings,instant(row,"created_at"),
            instant(row,"started_at"),instant(row,"finished_at"),instant(row,"expires_at"),row.getString("failure_code"),
            row.getString("sha256"),row.getLong("size_bytes"));
    }
    private static Instant instant(ResultSet row,String column) throws SQLException { var t=row.getTimestamp(column);return t==null ? null : t.toInstant(); }
}
