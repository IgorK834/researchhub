package dev.researchhub.notification.infrastructure;

import dev.researchhub.notification.application.DigestContracts.*;
import dev.researchhub.notification.application.NotificationContracts;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.*;

@Repository
public class PostgresDigests {
    private final JdbcTemplate jdbc;
    public PostgresDigests(JdbcTemplate jdbc) {this.jdbc=jdbc;}
    public List<UUID> workspaces(UUID user) {
        return jdbc.query("SELECT m.workspace_id FROM workspace_members m JOIN workspaces w ON w.id=m.workspace_id AND w.erasure_requested_at IS NULL WHERE m.user_id=? ORDER BY m.workspace_id LIMIT 101",(r,i)->r.getObject(1,UUID.class),user);
    }
    public Settings settings(UUID user,UUID workspace) {
        var frequencies=jdbc.query("SELECT frequency FROM digest_preferences WHERE user_id=? AND workspace_id=?",(r,i)->Frequency.valueOf(r.getString(1)),user,workspace);
        var muted=jdbc.query("SELECT type FROM notification_preferences WHERE user_id=? AND workspace_id=? AND muted ORDER BY type",(r,i)->NotificationContracts.Type.valueOf(r.getString(1)),user,workspace);
        return new Settings(frequencies.isEmpty()?Frequency.DAILY:frequencies.getFirst(),muted);
    }
    public void save(UUID user,UUID workspace,Settings settings) {
        jdbc.update("INSERT INTO digest_preferences VALUES(?,?,?) ON CONFLICT(user_id,workspace_id) DO UPDATE SET frequency=excluded.frequency",user,workspace,settings.frequency().name());
        jdbc.update("DELETE FROM notification_preferences WHERE user_id=? AND workspace_id=?",user,workspace);
        settings.mutedCategories().forEach(type->jdbc.update("INSERT INTO notification_preferences VALUES(?,?,?,true)",user,workspace,type.name()));
    }
    public Instant seen(UUID user,Instant fallback) {
        return jdbc.query("SELECT seen_at FROM digest_seen WHERE user_id=?",(r,i)->r.getTimestamp(1).toInstant(),user).stream().findFirst().orElse(fallback);
    }
    public void see(UUID user,Instant through) {
        jdbc.update("INSERT INTO digest_seen VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET seen_at=greatest(digest_seen.seen_at,excluded.seen_at)",user,Timestamp.from(through));
    }
    public List<Item> items(UUID user,UUID workspace,Instant start,Instant end) {
        // Current membership identity is mandatory, including when reading an already published digest.
        // Aggregate before limiting: counts never truncate event contents into the response.
        return jdbc.query("""
            SELECT o.workspace_id,o.type,count(*) AS total FROM notification_outbox o
            JOIN workspace_members m ON m.id=o.membership_id AND m.user_id=o.user_id AND m.workspace_id=o.workspace_id
            JOIN workspaces w ON w.id=o.workspace_id AND w.erasure_requested_at IS NULL
            WHERE o.user_id=? AND o.workspace_id=? AND o.created_at>? AND o.created_at<=?
            GROUP BY o.workspace_id,o.type ORDER BY o.type
            """,(r,i)->new Item(r.getObject(1,UUID.class),NotificationContracts.Type.valueOf(r.getString(2)),r.getInt(3),
                NotificationContracts.href(r.getObject(1,UUID.class),"WORKSPACE",null,null)),user,workspace,Timestamp.from(start),Timestamp.from(end));
    }
    public List<Digest> published(UUID user,UUID workspace,Instant cutoff) {
        return jdbc.query("""
            SELECT d.* FROM notification_digests d JOIN workspace_members m ON m.id=d.membership_id AND m.user_id=d.user_id AND m.workspace_id=d.workspace_id
            JOIN workspaces w ON w.id=d.workspace_id AND w.erasure_requested_at IS NULL
            WHERE d.user_id=? AND d.workspace_id=? AND d.window_end>=? ORDER BY d.window_end DESC,d.id DESC LIMIT 20
            """,(r,i)->new Digest(r.getObject("id",UUID.class),r.getTimestamp("window_start").toInstant(),r.getTimestamp("window_end").toInstant(),Frequency.valueOf(r.getString("frequency")),List.of()),user,workspace,Timestamp.from(cutoff));
    }
    public void publish(Instant now,Instant cutoff) {
        // The outbox is the durable job source. Retry and concurrent schedulers converge on the unique recipient/window.
        jdbc.update("""
            INSERT INTO notification_digests(user_id,workspace_id,membership_id,frequency,window_start,window_end,published_at)
            SELECT DISTINCT o.user_id,o.workspace_id,o.membership_id,f.frequency,
              date_trunc(CASE WHEN f.frequency='WEEKLY' THEN 'week' ELSE 'day' END,o.created_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC',
              (date_trunc(CASE WHEN f.frequency='WEEKLY' THEN 'week' ELSE 'day' END,o.created_at AT TIME ZONE 'UTC')+
                CASE WHEN f.frequency='WEEKLY' THEN interval '7 days' ELSE interval '1 day' END) AT TIME ZONE 'UTC',?::timestamptz
            FROM notification_outbox o JOIN workspace_members m ON m.id=o.membership_id AND m.user_id=o.user_id AND m.workspace_id=o.workspace_id
            JOIN workspaces w ON w.id=o.workspace_id AND w.erasure_requested_at IS NULL
            JOIN users u ON u.id=o.user_id AND u.status='ACTIVE'
            LEFT JOIN digest_preferences p ON p.user_id=o.user_id AND p.workspace_id=o.workspace_id
            CROSS JOIN (VALUES ('DAILY'),('WEEKLY')) f(frequency)
            WHERE o.created_at>=? AND coalesce(p.frequency,'DAILY')<>'MUTED'
            AND NOT EXISTS(SELECT 1 FROM notification_preferences n WHERE n.user_id=o.user_id AND n.workspace_id=o.workspace_id AND n.type=o.type AND n.muted)
            AND (date_trunc(CASE WHEN f.frequency='WEEKLY' THEN 'week' ELSE 'day' END,o.created_at AT TIME ZONE 'UTC')+
                CASE WHEN f.frequency='WEEKLY' THEN interval '7 days' ELSE interval '1 day' END) AT TIME ZONE 'UTC'<=?
            AND NOT EXISTS(SELECT 1 FROM notification_digests d WHERE d.user_id=o.user_id AND d.membership_id=o.membership_id AND d.frequency=f.frequency
              AND d.window_start=date_trunc(CASE WHEN f.frequency='WEEKLY' THEN 'week' ELSE 'day' END,o.created_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')
            ORDER BY 6,1,2 LIMIT 200 ON CONFLICT DO NOTHING
            """,Timestamp.from(now),Timestamp.from(cutoff),Timestamp.from(now));
    }
    public void cleanup(Instant cutoff) {
        jdbc.update("DELETE FROM notification_digests WHERE id IN (SELECT id FROM notification_digests WHERE window_end<? ORDER BY window_end LIMIT 1000)",Timestamp.from(cutoff));
    }
}
