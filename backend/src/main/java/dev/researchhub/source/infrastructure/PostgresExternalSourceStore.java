package dev.researchhub.source.infrastructure;

import dev.researchhub.source.application.ExternalSourceStore;
import dev.researchhub.source.application.ExternalSourceContracts.*;
import dev.researchhub.shared.error.ResourceNotFoundException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.ObjectMapper;
import java.sql.Timestamp;
import java.util.UUID;

@Repository
public class PostgresExternalSourceStore implements ExternalSourceStore {
    private final JdbcTemplate jdbc;
    private final ObjectMapper json;
    public PostgresExternalSourceStore(JdbcTemplate jdbc, ObjectMapper json) { this.jdbc = jdbc; this.json = json; }
    public Search saveSearch(Search search) {
        jdbc.update("INSERT INTO external_source_searches(id,workspace_id,searched_by,payload,searched_at) VALUES (?,?,?,?::jsonb,?)",
                search.id(), search.workspaceId(), search.searchedBy(), json.writeValueAsString(search), Timestamp.from(search.searchedAt()));
        return search;
    }
    public Search findSearch(UUID workspaceId, UUID searchId) {
        return jdbc.query("SELECT payload FROM external_source_searches WHERE workspace_id=? AND id=?",
                (row, index) -> json.readValue(row.getString("payload"), Search.class), workspaceId, searchId)
                .stream().findFirst().orElseThrow(() -> new ResourceNotFoundException("External search was not found"));
    }
    public Reference record(Reference reference) {
        jdbc.update("""
                INSERT INTO external_source_references(id,workspace_id,search_id,result_id,recorded_by,payload,recorded_at)
                VALUES (?,?,?,?,?,?::jsonb,?) ON CONFLICT (workspace_id,search_id,result_id) DO NOTHING
                """, reference.id(), reference.workspaceId(), reference.searchId(), reference.resultId(), reference.recordedBy(),
                json.writeValueAsString(reference), Timestamp.from(reference.recordedAt()));
        return jdbc.query("SELECT payload FROM external_source_references WHERE workspace_id=? AND search_id=? AND result_id=?",
                (row, index) -> json.readValue(row.getString("payload"), Reference.class),
                reference.workspaceId(), reference.searchId(), reference.resultId()).getFirst();
    }
    @Transactional(readOnly = true, isolation = org.springframework.transaction.annotation.Isolation.REPEATABLE_READ)
    public Page list(UUID workspaceId, int page, int size) {
        long total = jdbc.queryForObject("SELECT count(*) FROM external_source_references WHERE workspace_id=?", Long.class, workspaceId);
        var items = jdbc.query("SELECT payload FROM external_source_references WHERE workspace_id=? ORDER BY recorded_at DESC,id DESC LIMIT ? OFFSET ?",
                (row, index) -> json.readValue(row.getString("payload"), Reference.class), workspaceId, size, (long) page * size);
        return new Page(items, total, page, size, (long) (page + 1) * size < total);
    }
}
