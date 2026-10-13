package dev.researchhub.source.infrastructure;

import dev.researchhub.source.application.BibliographyImportContracts.*;
import dev.researchhub.source.application.SourceBibliography;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import tools.jackson.databind.ObjectMapper;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/** PostgreSQL persistence for previews, frozen decisions, and bibliographic-only items. */
@Repository
public class PostgresBibliographyImportStore {
    private final JdbcTemplate jdbc;
    private final ObjectMapper json;

    public PostgresBibliographyImportStore(JdbcTemplate jdbc, ObjectMapper json) {
        this.jdbc = jdbc;
        this.json = json;
    }

    public record ImportRow(Preview preview, String status, String confirmationSha256, Result result) {}
    public record Candidate(MatchKind kind, UUID id, String title, SourceBibliography bibliography,
                            List<String> tags, List<String> collections) {}

    public void serializeWorkspace(UUID workspaceId) {
        jdbc.query("SELECT pg_advisory_xact_lock(hashtextextended(?::text, 352))", row -> {}, workspaceId.toString());
    }

    public Optional<ImportRow> findActive(UUID workspaceId, String sha256) {
        return rows("""
                SELECT preview::text,status,confirmation_sha256,result::text FROM bibliography_imports
                WHERE workspace_id=? AND file_sha256=? AND status IN ('PREVIEWED','CONFIRMED')
                ORDER BY created_at DESC LIMIT 1
                """, workspaceId, sha256).stream().findFirst();
    }

    public Optional<ImportRow> find(UUID workspaceId, UUID importId) {
        return rows("""
                SELECT preview::text,status,confirmation_sha256,result::text FROM bibliography_imports
                WHERE workspace_id=? AND id=?
                """, workspaceId, importId).stream().findFirst();
    }

    public Optional<ImportRow> findForUpdate(UUID workspaceId, UUID importId) {
        return rows("""
                SELECT preview::text,status,confirmation_sha256,result::text FROM bibliography_imports
                WHERE workspace_id=? AND id=? FOR UPDATE
                """, workspaceId, importId).stream().findFirst();
    }

    private List<ImportRow> rows(String sql, Object... args) {
        return jdbc.query(sql, (row, ignored) -> new ImportRow(
                json.readValue(row.getString(1), Preview.class), row.getString(2), row.getString(3),
                row.getString(4) == null ? null : json.readValue(row.getString(4), Result.class)), args);
    }

    public void create(Preview preview, UUID createdBy) {
        jdbc.update("""
                INSERT INTO bibliography_imports(id,workspace_id,created_by,file_name,file_sha256,format,origin,status,
                    record_count,preview,created_at) VALUES (?,?,?,?,?,?,?,'PREVIEWED',?,?::jsonb,?)
                """, preview.id(), preview.workspaceId(), createdBy, preview.fileName(), preview.fileSha256(),
                preview.format().name(), preview.origin().name(), preview.totalRecords(),
                json.writeValueAsString(preview), Timestamp.from(preview.createdAt()));
    }

    public List<Candidate> candidates(UUID workspaceId) {
        var result = new ArrayList<Candidate>();
        result.addAll(jdbc.query("""
                SELECT id,coalesce(bibliography->>'title',display_name),bibliography::text,tags::text,collections::text
                FROM sources WHERE workspace_id=?
                """, (row, ignored) -> new Candidate(MatchKind.SOURCE, row.getObject(1, UUID.class), row.getString(2),
                json.readValue(row.getString(3), SourceBibliography.class), labels(row.getString(4)), labels(row.getString(5))), workspaceId));
        result.addAll(jdbc.query("""
                SELECT id,coalesce(bibliography->>'title','Untitled reference'),bibliography::text,tags::text,collections::text
                FROM bibliography_items WHERE workspace_id=?
                """, (row, ignored) -> new Candidate(MatchKind.BIBLIOGRAPHIC_ITEM, row.getObject(1, UUID.class), row.getString(2),
                json.readValue(row.getString(3), SourceBibliography.class), labels(row.getString(4)), labels(row.getString(5))), workspaceId));
        return List.copyOf(result);
    }

    private List<String> labels(String value) { return List.of(json.readValue(value,String[].class)); }

    public ItemPage items(UUID workspaceId, int offset) {
        var rows = jdbc.query("""
            SELECT id,source_id,item_type,bibliography::text,tags::text,collections::text,updated_at
            FROM bibliography_items WHERE workspace_id=? ORDER BY created_at DESC,id DESC LIMIT 51 OFFSET ?
            """, (row,index) -> new Item(row.getObject(1,UUID.class),row.getObject(2,UUID.class),row.getString(3),
            json.readValue(row.getString(4),SourceBibliography.class),labels(row.getString(5)),labels(row.getString(6)),
            row.getTimestamp(7).toInstant()),workspaceId,offset);
        return new ItemPage(rows.stream().limit(50).toList(),rows.size()>50 ? offset+50 : -1);
    }

    public boolean updateItem(UUID workspaceId, UUID id, ItemUpdate update, String fingerprint, Instant now) {
        return jdbc.update("""
            UPDATE bibliography_items SET bibliography=?::jsonb,tags=?::jsonb,collections=?::jsonb,
                normalized_doi=?,metadata_fingerprint=?,updated_at=? WHERE workspace_id=? AND id=? AND updated_at=?
            """,json.writeValueAsString(update.bibliography()),json.writeValueAsString(update.tags()),
            json.writeValueAsString(update.collections()),update.bibliography().doi(),fingerprint,Timestamp.from(now),
            workspaceId,id,Timestamp.from(update.expectedUpdatedAt()))==1;
    }

    public boolean updateCandidate(UUID workspace, Candidate before, SourceBibliography bibliography,
                                   List<String> tags,List<String> collections,String fingerprint,Instant now) {
        if(before.kind()==MatchKind.SOURCE)
            return jdbc.update("""
                UPDATE sources SET bibliography=?::jsonb,tags=?::jsonb,collections=?::jsonb,updated_at=?
                WHERE workspace_id=? AND id=? AND bibliography=?::jsonb AND tags=?::jsonb AND collections=?::jsonb
                """,json.writeValueAsString(bibliography),json.writeValueAsString(tags),json.writeValueAsString(collections),
                Timestamp.from(now),workspace,before.id(),json.writeValueAsString(before.bibliography()),
                json.writeValueAsString(before.tags()),json.writeValueAsString(before.collections()))==1;
        return jdbc.update("""
                UPDATE bibliography_items SET bibliography=?::jsonb,tags=?::jsonb,collections=?::jsonb,updated_at=?,
                    normalized_doi=?,metadata_fingerprint=? WHERE workspace_id=? AND id=? AND bibliography=?::jsonb
                    AND tags=?::jsonb AND collections=?::jsonb
                """,json.writeValueAsString(bibliography),json.writeValueAsString(tags),json.writeValueAsString(collections),
                Timestamp.from(now),bibliography.doi(),fingerprint,workspace,before.id(),json.writeValueAsString(before.bibliography()),
                json.writeValueAsString(before.tags()),json.writeValueAsString(before.collections()))==1;
    }

    public boolean citationKeyExists(UUID workspaceId, String citationKey, UUID exceptSourceId) {
        if (citationKey == null) return false;
        Integer count = jdbc.queryForObject("""
                SELECT (SELECT count(*) FROM sources WHERE workspace_id=? AND lower(bibliography->>'citationKey')=lower(?)
                            AND (?::uuid IS NULL OR id<>?::uuid))
                     + (SELECT count(*) FROM bibliography_items WHERE workspace_id=?
                            AND lower(bibliography->>'citationKey')=lower(?) AND (?::uuid IS NULL OR id<>?::uuid))
                """, Integer.class, workspaceId, citationKey, exceptSourceId, exceptSourceId, workspaceId, citationKey,exceptSourceId,exceptSourceId);
        return count != null && count > 0;
    }

    public UUID createItem(UUID workspaceId, UUID createdBy, String itemType, SourceBibliography bibliography,
                           List<String> tags, List<String> collections, String fingerprint,
                           UUID importId, int recordNumber, String fileSha256, Instant now) {
        UUID id = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO bibliography_items(id,workspace_id,item_type,bibliography,tags,collections,normalized_doi,
                    metadata_fingerprint,import_origin,created_by,created_at,updated_at)
                VALUES (?,?,?,?::jsonb,?::jsonb,?::jsonb,?,?,jsonb_build_object('importId',?::text,
                    'recordNumber',?,'fileSha256',?),?,?,?)
                """, id, workspaceId, itemType, json.writeValueAsString(bibliography), json.writeValueAsString(tags),
                json.writeValueAsString(collections), bibliography.doi(), fingerprint, importId.toString(), recordNumber,
                fileSha256, createdBy, Timestamp.from(now), Timestamp.from(now));
        return id;
    }

    public void record(UUID workspaceId, UUID importId, int recordNumber, ConfirmAction action, Outcome outcome,
                       SourceBibliography accepted, MatchKind targetKind, UUID targetId, Instant now) {
        jdbc.update("""
                INSERT INTO bibliography_import_records(import_id,workspace_id,record_number,action,outcome,
                    accepted_metadata,target_kind,target_id,created_at) VALUES (?,?,?,?,?,?::jsonb,?,?,?)
                """, importId, workspaceId, recordNumber, action.name(), outcome.name(),
                accepted == null ? null : json.writeValueAsString(accepted),
                targetKind == null ? null : targetKind.name(), targetId, Timestamp.from(now));
    }

    public void confirm(UUID workspaceId, UUID importId, String confirmationSha256, Result result) {
        int updated = jdbc.update("""
                UPDATE bibliography_imports SET status='CONFIRMED',confirmation_sha256=?,result=?::jsonb,confirmed_at=?
                WHERE workspace_id=? AND id=? AND status='PREVIEWED'
                """, confirmationSha256, json.writeValueAsString(result), Timestamp.from(result.confirmedAt()),
                workspaceId, importId);
        if (updated != 1) throw new IllegalStateException("Bibliography import state changed");
    }

    public boolean cancel(UUID workspaceId, UUID importId, Instant now) {
        return jdbc.update("""
                UPDATE bibliography_imports SET status='CANCELLED',cancelled_at=?
                WHERE workspace_id=? AND id=? AND status='PREVIEWED'
                """, Timestamp.from(now), workspaceId, importId) == 1;
    }
}
