package dev.researchhub.search.infrastructure;

import dev.researchhub.search.application.WorkspaceSearchContracts.Cursor;
import dev.researchhub.search.application.WorkspaceSearchContracts.Type;
import dev.researchhub.search.application.WorkspaceSearchStore;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.sql.Timestamp;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.UUID;

@Repository
public class PostgresWorkspaceSearchStore implements WorkspaceSearchStore {
    private final JdbcTemplate jdbc;

    public PostgresWorkspaceSearchStore(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    public List<Hit> search(UUID workspaceId, UUID callerId, String query, Set<Type> types, Cursor cursor, int fetchLimit) {
        var sql = new StringBuilder("""
                SELECT type,object_id,title,
                    ts_headline('simple'::regconfig,content,websearch_to_tsquery('simple'::regconfig,?),
                        'StartSel=, StopSel=, MaxWords=45, MinWords=15, MaxFragments=1') AS content,
                    location,source_version,updated_at
                FROM workspace_search_entries e
                WHERE workspace_id=? AND archived=false
                  AND EXISTS(SELECT 1 FROM workspace_members m JOIN workspaces w ON w.id=m.workspace_id
                    WHERE m.workspace_id=? AND m.user_id=? AND w.erasure_requested_at IS NULL)
                  AND search_vector @@ websearch_to_tsquery('simple'::regconfig,?)
                """);
        var args = new ArrayList<Object>();
        args.add(query);
        args.add(workspaceId);
        args.add(workspaceId);
        args.add(callerId);
        args.add(query);
        if (!types.isEmpty()) {
            sql.append(" AND type IN (");
            sql.append(String.join(",", java.util.Collections.nCopies(types.size(), "?")));
            sql.append(')');
            types.stream().map(Enum::name).sorted().forEach(args::add);
        }
        if (cursor != null) {
            sql.append("""
                     AND (updated_at < ? OR (updated_at = ? AND
                         (type > ? OR (type = ? AND object_id < ?))))
                    """);
            args.add(Timestamp.from(cursor.updatedAt()));
            args.add(Timestamp.from(cursor.updatedAt()));
            args.add(cursor.type().name());
            args.add(cursor.type().name());
            args.add(cursor.id());
        }
        sql.append(" ORDER BY updated_at DESC,type ASC,object_id DESC LIMIT ?");
        args.add(fetchLimit);
        return jdbc.query(sql.toString(), (row, ignored) -> new Hit(Type.valueOf(row.getString(1)),
                row.getObject(2, UUID.class), row.getString(3), row.getString(4), row.getString(5), row.getString(6),
                row.getTimestamp(7).toInstant()), args.toArray());
    }
}
