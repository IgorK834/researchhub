package dev.researchhub.notification.infrastructure;

import dev.researchhub.notification.application.NotificationContracts.*;
import dev.researchhub.notification.application.NotificationContracts;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

@Repository
public class PostgresNotifications {
    private final JdbcTemplate jdbc;
    public PostgresNotifications(JdbcTemplate jdbc) { this.jdbc=jdbc; }
    public List<Notification> page(UUID user, Cursor cursor, int limit, boolean unread, Type type, Instant cutoff) {
        return jdbc.query("""
            SELECT * FROM visible_notifications WHERE user_id=? AND created_at>=?
            AND (NOT ? OR read_at IS NULL) AND (?::text IS NULL OR type=?::text)
            AND (?::timestamptz IS NULL OR (created_at,id)<(?::timestamptz,?::uuid))
            ORDER BY created_at DESC,id DESC LIMIT ?
            """, (r,i)->new Notification(r.getObject("id",UUID.class),r.getObject("event_id",UUID.class),r.getObject("workspace_id",UUID.class),
            Type.valueOf(r.getString("type")),r.getString("target_type"),r.getObject("target_id",UUID.class),r.getObject("document_id",UUID.class),
            r.getTimestamp("created_at").toInstant(),r.getTimestamp("read_at")==null ? null : r.getTimestamp("read_at").toInstant(),
            NotificationContracts.href(r.getObject("workspace_id",UUID.class),r.getString("target_type"),r.getObject("target_id",UUID.class),r.getObject("document_id",UUID.class)),r.getString("workspace_label"),r.getString("target_label")),
            user,Timestamp.from(cutoff),unread,type==null ? null : type.name(),type==null ? null : type.name(),
            cursor==null ? null : Timestamp.from(cursor.time()),cursor==null ? null : Timestamp.from(cursor.time()),cursor==null ? null : cursor.id(),limit);
    }
    public int unread(UUID user, Instant cutoff) {
        return jdbc.queryForObject("SELECT count(*) FROM (SELECT 1 FROM visible_notifications WHERE user_id=? AND created_at>=? AND read_at IS NULL LIMIT 1001) bounded",Integer.class,user,Timestamp.from(cutoff));
    }
    public boolean read(UUID user, UUID id, Instant now, Instant cutoff) {
        return jdbc.update("""
            UPDATE notifications SET read_at=coalesce(read_at,?) WHERE id IN
            (SELECT id FROM visible_notifications WHERE user_id=? AND id=? AND created_at>=?)
            """,Timestamp.from(now),user,id,Timestamp.from(cutoff))==1;
    }
    public int readAll(UUID user, Instant before, int limit, Instant now, Instant cutoff) {
        return jdbc.update("""
            UPDATE notifications SET read_at=? WHERE id IN (SELECT id FROM visible_notifications
            WHERE user_id=? AND read_at IS NULL AND created_at>=? AND created_at<=? ORDER BY created_at,id LIMIT ?)
            AND read_at IS NULL
            """,Timestamp.from(now),user,Timestamp.from(cutoff),Timestamp.from(before),limit);
    }
    public List<Preference> preferences(UUID user,UUID workspace) {
        return jdbc.query("SELECT type,muted FROM notification_preferences WHERE user_id=? AND workspace_id=? ORDER BY type",
            (r,i)->new Preference(Type.valueOf(r.getString("type")),r.getBoolean("muted")),user,workspace);
    }
    public void preference(UUID user,UUID workspace,Type type,boolean muted) {
        jdbc.update("""
            INSERT INTO notification_preferences(user_id,workspace_id,type,muted) VALUES(?,?,?,?)
            ON CONFLICT(user_id,workspace_id,type) DO UPDATE SET muted=excluded.muted
            """,user,workspace,type.name(),muted);
    }
    public record Delivery(UUID event,UUID user) {}
    public Delivery next(Instant now) {
        UUID workspace=jdbc.query("SELECT workspace_id FROM notification_outbox WHERE delivered_at IS NULL AND available_at<=? ORDER BY available_at,event_id,user_id LIMIT 1",
            (r,i)->r.getObject(1,UUID.class),Timestamp.from(now)).stream().findFirst().orElse(null);
        if(workspace==null)return null;
        // Membership mutations take this lock first too: avoid the outbox/member lock inversion.
        jdbc.query("SELECT id FROM workspaces WHERE id=? FOR SHARE",(r,i)->r.getObject(1,UUID.class),workspace);
        return jdbc.query("""
            SELECT event_id,user_id FROM notification_outbox WHERE workspace_id=? AND delivered_at IS NULL AND available_at<=?
            ORDER BY available_at,event_id,user_id LIMIT 1 FOR UPDATE SKIP LOCKED
            """,(r,i)->new Delivery(r.getObject(1,UUID.class),r.getObject(2,UUID.class)),workspace,Timestamp.from(now)).stream().findFirst().orElse(null);
    }
    public void deliver(Delivery delivery,Instant now,Instant cutoff) {
        // Lock the current membership against DELETE through the insert/ack transaction.
        jdbc.query("""
            SELECT m.id FROM workspace_members m JOIN notification_outbox o ON o.membership_id=m.id
            WHERE o.event_id=? AND o.user_id=? FOR SHARE OF m
            """,(r,i)->r.getObject(1,UUID.class),delivery.event(),delivery.user());
        jdbc.update("""
            INSERT INTO notifications(id,user_id,event_id,membership_id,workspace_id,type,target_type,target_id,document_id,created_at)
            SELECT ?,o.user_id,o.event_id,o.membership_id,o.workspace_id,o.type,o.target_type,o.target_id,o.document_id,o.created_at
            FROM notification_outbox o JOIN workspace_members m ON m.id=o.membership_id AND m.workspace_id=o.workspace_id AND m.user_id=o.user_id
            JOIN workspaces w ON w.id=o.workspace_id AND w.erasure_requested_at IS NULL
            JOIN users u ON u.id=o.user_id AND u.status='ACTIVE'
            WHERE o.event_id=? AND o.user_id=? AND o.created_at>=?
            AND NOT EXISTS(SELECT 1 FROM notification_preferences p WHERE p.user_id=o.user_id AND p.workspace_id=o.workspace_id AND p.type=o.type AND p.muted)
            AND (o.type<>'MENTION' OR EXISTS(SELECT 1 FROM document_comments c WHERE c.id=o.target_id AND c.workspace_id=o.workspace_id
              AND c.mentions @> jsonb_build_array(jsonb_build_object('userId',o.user_id::text)))
              OR EXISTS(SELECT 1 FROM comment_replies r WHERE r.id=o.reply_id AND r.workspace_id=o.workspace_id
              AND r.mentions @> jsonb_build_array(jsonb_build_object('userId',o.user_id::text))))
            ON CONFLICT(user_id,event_id) DO NOTHING
            """,UUID.randomUUID(),delivery.event(),delivery.user(),Timestamp.from(cutoff));
        jdbc.update("UPDATE notification_outbox SET delivered_at=? WHERE event_id=? AND user_id=?",Timestamp.from(now),delivery.event(),delivery.user());
        jdbc.update("DELETE FROM notifications WHERE user_id=? AND id IN (SELECT id FROM notifications WHERE user_id=? ORDER BY created_at DESC,id DESC OFFSET 1000)",delivery.user(),delivery.user());
    }
    public void retry(Delivery delivery,Instant now) {
        jdbc.update("""
            UPDATE notification_outbox SET attempts=least(attempts+1,20), available_at=?::timestamptz +
            make_interval(secs=>least(3600,power(2,least(attempts+1,12))::integer)) WHERE event_id=? AND user_id=? AND delivered_at IS NULL
            """,Timestamp.from(now),delivery.event(),delivery.user());
    }
    public void cleanup(Instant cutoff) {
        jdbc.update("DELETE FROM notifications WHERE id IN (SELECT id FROM notifications WHERE created_at<? ORDER BY created_at LIMIT 1000)",Timestamp.from(cutoff));
        jdbc.update("DELETE FROM notification_outbox WHERE (user_id,event_id) IN (SELECT user_id,event_id FROM notification_outbox WHERE created_at<? ORDER BY created_at LIMIT 1000)",Timestamp.from(cutoff));
    }
}
