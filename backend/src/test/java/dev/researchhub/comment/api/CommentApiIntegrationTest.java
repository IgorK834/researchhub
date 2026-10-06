package dev.researchhub.comment.api;

import dev.researchhub.shared.infrastructure.persistence.PostgresTestcontainersConfiguration;
import dev.researchhub.support.ApiBrowser;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import tools.jackson.databind.ObjectMapper;

import java.util.Map;
import java.util.UUID;
import java.util.concurrent.Executors;
import java.util.concurrent.CountDownLatch;

import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@ActiveProfiles("local")
@Import(PostgresTestcontainersConfiguration.class)
class CommentApiIntegrationTest {
    @Value("${local.server.port}") int port;
    @Autowired ObjectMapper json;
    @Autowired JdbcTemplate jdbc;
    ApiBrowser owner, editor, viewer, outsider;
    String workspace, route, ownerId, editorId;
    UUID anchor, commentId;

    @BeforeEach void setup() throws Exception {
        jdbc.execute("TRUNCATE users, workspaces, workspace_members, documents, document_versions CASCADE");
        owner = new ApiBrowser(port, json); editor = new ApiBrowser(port, json);
        viewer = new ApiBrowser(port, json); outsider = new ApiBrowser(port, json);
        ownerId = owner.signUp("owner@comments.test", "Owner");
        editorId = editor.signUp("editor@comments.test", "Editor");
        viewer.signUp("viewer@comments.test", "Viewer"); outsider.signUp("outsider@comments.test", "Outsider");
        workspace = owner.createdWorkspaceId("Review", "Comments");
        assertEquals(201, owner.postJson("/api/workspaces/"+workspace+"/members", "{\"email\":\"editor@comments.test\",\"role\":\"EDITOR\"}").statusCode());
        assertEquals(201, owner.postJson("/api/workspaces/"+workspace+"/members", "{\"email\":\"viewer@comments.test\",\"role\":\"VIEWER\"}").statusCode());
        anchor = UUID.randomUUID(); commentId = UUID.randomUUID();
        route = document(workspace, anchor);
    }
    @AfterEach void cleanReviewRows() {
        // This application context is shared with other HTTP suites; leave no owned document/workspace rows.
        jdbc.execute("TRUNCATE users, workspaces, workspace_members, documents, document_versions CASCADE");
    }
    String document(String workspaceId, UUID anchorId) throws Exception {
        var response = owner.postJson("/api/workspaces/"+workspaceId+"/documents", json.writeValueAsString(Map.of("title", "Report", "content", json.readTree(content(anchorId)))));
        assertEquals(201, response.statusCode(), response.body());
        return "/api/workspaces/"+workspaceId+"/documents/"+owner.json(response).path("id").asString();
    }
    static String content(UUID anchorId) {
        return """
                {"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Evidence","marks":[{"type":"commentAnchor","attrs":{"ids":["%s"]}}]}]}]}
                """.formatted(anchorId);
    }
    String createBody(UUID id, UUID anchorId, String body) {
        return json.writeValueAsString(Map.of("id", id, "body", body, "anchor", Map.of("strategy", "TEXT_MARK_V1", "id", anchorId, "quote", "Evidence")));
    }
    String create() throws Exception {
        var response = editor.postJson(route+"/comments", createBody(commentId, anchor, "  Cite the standard?  "));
        assertEquals(201, response.statusCode(), response.body());
        assertEquals("Cite the standard?", editor.json(response).path("body").asString());
        return route+"/comments/"+commentId;
    }
    @Test void persistsAThreadWithContributionHistoryAcrossReadReloadResolveAndReopen() throws Exception {
        String thread = create();
        UUID reply = UUID.randomUUID();
        String body = json.writeValueAsString(Map.of("id", reply, "body", "I will add the source."));
        assertEquals(201, owner.postJson(thread+"/replies", body).statusCode());
        assertEquals(201, owner.postJson(thread+"/replies", body).statusCode(), "Lost-response retry is idempotent");
        assertEquals(201, editor.postJson(route+"/comments", createBody(commentId, anchor, "Cite the standard?")).statusCode());
        var list = viewer.json(viewer.get(route+"/comments"));
        assertEquals(1, list.size()); assertEquals(1, list.get(0).path("replies").size());
        assertEquals(editorId, list.get(0).path("authorId").asString());
        assertEquals("Editor", list.get(0).path("authorName").asString()); assertFalse(list.get(0).path("orphaned").asBoolean());
        var resolved = owner.patchJson(thread, "{\"status\":\"RESOLVED\"}");
        assertEquals(200, resolved.statusCode(), resolved.body());
        assertEquals(ownerId, owner.json(resolved).path("resolvedBy").asString());
        assertFalse(owner.json(resolved).path("resolvedAt").isNull());
        assertEquals(200, owner.patchJson(thread, "{\"status\":\"RESOLVED\"}").statusCode());
        assertEquals(409, owner.postJson(thread+"/replies", json.writeValueAsString(Map.of("id", UUID.randomUUID(), "body", "New reply"))).statusCode());
        assertEquals(201, owner.postJson(thread+"/replies", body).statusCode(), "Retry of an existing reply succeeds after resolve");
        var reopened = editor.patchJson(thread, "{\"status\":\"OPEN\"}");
        assertEquals(200, reopened.statusCode()); assertTrue(editor.json(reopened).path("resolvedBy").isNull());
        assertTrue(editor.json(reopened).path("resolvedAt").isNull());
        var history = viewer.json(viewer.get(thread)).path("events");
        assertEquals(4, history.size());
        assertEquals("CREATED", history.get(0).path("action").asString());
        assertEquals("REPLIED", history.get(1).path("action").asString());
        assertEquals("RESOLVED", history.get(2).path("action").asString());
        assertEquals("REOPENED", history.get(3).path("action").asString());
        assertFalse(history.toString().contains("email"));
    }
    @Test void authorizationScopesEveryReadWriteReplyAndAuditRoute() throws Exception {
        String thread = create();
        String reply = json.writeValueAsString(Map.of("id", UUID.randomUUID(), "body", "Reply"));
        assertEquals(200, viewer.get(thread).statusCode());
        assertEquals(403, viewer.postJson(route+"/comments", createBody(UUID.randomUUID(), anchor, "Read only")).statusCode());
        assertEquals(403, viewer.patchJson(thread, "{\"status\":\"RESOLVED\"}").statusCode());
        assertEquals(403, viewer.postJson(thread+"/replies", reply).statusCode());
        for (String path : new String[]{route+"/comments", thread}) {
            assertEquals(404, outsider.get(path).statusCode());
            assertEquals(401, new ApiBrowser(port, json).get(path).statusCode());
        }
        assertEquals(404, outsider.postJson(route+"/comments", createBody(UUID.randomUUID(), anchor, "Secret")).statusCode());
        assertEquals(404, outsider.patchJson(thread, "{\"status\":\"OPEN\"}").statusCode());
        assertEquals(404, outsider.postJson(thread+"/replies", reply).statusCode());
        assertEquals(403, owner.sendWithoutCsrf("POST", route+"/comments", createBody(UUID.randomUUID(), anchor, "CSRF")).statusCode());
        assertEquals(403, owner.sendWithoutCsrf("PATCH", thread, "{\"status\":\"RESOLVED\"}").statusCode());
        String otherWorkspace = owner.createdWorkspaceId("Other", "Other");
        String otherRoute = document(otherWorkspace, UUID.randomUUID());
        assertEquals(404, owner.get(otherRoute+"/comments/"+commentId).statusCode());
        assertEquals(404, owner.patchJson(otherRoute+"/comments/"+commentId, "{\"status\":\"OPEN\"}").statusCode());
        assertEquals(404, owner.postJson(otherRoute+"/comments/"+commentId+"/replies", reply).statusCode());
        assertEquals(404, owner.get(route.replace(workspace, otherWorkspace)+"/comments").statusCode());
        owner.patchJson("/api/workspaces/"+workspace+"/members/"+editorId, "{\"role\":\"VIEWER\"}");
        assertEquals(403, editor.patchJson(thread, "{\"status\":\"RESOLVED\"}").statusCode());
        owner.delete("/api/workspaces/"+workspace+"/members/"+editorId);
        assertEquals(404, editor.get(thread).statusCode());
        assertEquals("Editor", owner.json(owner.get(thread)).path("comment").path("authorName").asString());
    }
    @Test void nearbySavedEditsKeepAssociationDeletionOrphansAndRestoreRecoversTheAnchor() throws Exception {
        String thread = create();
        var before = owner.json(owner.get(route+"/versions")).get(0).path("id").asString();
        String nearby = content(anchor).replace("Evidence", "Nearby edits and Evidence");
        assertEquals(200, owner.patchJson(route, "{\"title\":\"Report\",\"revision\":1,\"content\":"+nearby+"}").statusCode());
        assertFalse(viewer.json(viewer.get(thread)).path("comment").path("orphaned").asBoolean());
        assertEquals(200, owner.patchJson(route, "{\"title\":\"Report\",\"revision\":2,\"content\":{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\"}]}}").statusCode());
        assertTrue(viewer.json(viewer.get(thread)).path("comment").path("orphaned").asBoolean());
        assertEquals(200, owner.patchJson(thread, "{\"status\":\"RESOLVED\"}").statusCode(), "An orphan can still be reviewed");
        assertEquals(200, owner.postJson(route+"/versions/"+before+"/restore", "{\"revision\":3}").statusCode());
        assertFalse(viewer.json(viewer.get(thread)).path("comment").path("orphaned").asBoolean());
        assertEquals(409, owner.postJson(route+"/comments", createBody(UUID.randomUUID(), UUID.randomUUID(), "Missing anchor")).statusCode());
    }
    @Test void rejectsInvalidValuesAndConflictingIdempotencyKeysWithoutExtraEvents() throws Exception {
        String thread = create();
        assertEquals(409, editor.postJson(route+"/comments", createBody(commentId, anchor, "Changed retry")).statusCode());
        assertEquals(409, owner.postJson(route+"/comments", createBody(commentId, anchor, "Cite the standard?")).statusCode());
        assertEquals(409, owner.postJson(route+"/comments", createBody(UUID.randomUUID(), anchor, "Duplicate anchor")).statusCode());
        assertEquals(400, owner.postJson(route+"/comments", createBody(UUID.randomUUID(), anchor, " ")).statusCode());
        assertEquals(400, owner.postJson(route+"/comments", createBody(UUID.randomUUID(), anchor, "x".repeat(4001))).statusCode());
        assertEquals(400, owner.postJson(route+"/comments", createBody(UUID.randomUUID(), anchor, "Text").replace("TEXT_MARK_V1", "OFFSET")).statusCode());
        assertEquals(400, owner.postJson(route+"/comments", "{}").statusCode());
        assertEquals(400, owner.patchJson(thread, "{\"status\":\"CLOSED\"}").statusCode());
        UUID replyId = UUID.randomUUID();
        assertEquals(201, editor.postJson(thread+"/replies", json.writeValueAsString(Map.of("id", replyId, "body", "Reply"))).statusCode());
        assertEquals(409, editor.postJson(thread+"/replies", json.writeValueAsString(Map.of("id", replyId, "body", "Changed"))).statusCode());
        assertEquals(409, owner.postJson(thread+"/replies", json.writeValueAsString(Map.of("id", replyId, "body", "Reply"))).statusCode());
        assertEquals(2, viewer.json(viewer.get(thread)).path("events").size());
    }
    @Test void archivedDocumentsAndWorkspacesRemainReadableButRefuseAllReviewWrites() throws Exception {
        String thread = create();
        assertEquals(204, owner.delete(route).statusCode());
        assertEquals(200, viewer.get(thread).statusCode());
        assertEquals(409, owner.patchJson(thread, "{\"status\":\"RESOLVED\"}").statusCode());
        assertEquals(409, owner.postJson(thread+"/replies", json.writeValueAsString(Map.of("id", UUID.randomUUID(), "body", "Reply"))).statusCode());
        assertEquals(409, owner.postJson(route+"/comments", createBody(UUID.randomUUID(), anchor, "New")).statusCode());
        assertEquals(200, owner.postJson("/api/workspaces/"+workspace+"/archive", "{}").statusCode());
        assertEquals(200, viewer.get(route+"/comments").statusCode());
        assertEquals(409, owner.patchJson(thread, "{\"status\":\"OPEN\"}").statusCode());
    }
    @Test void concurrentRetriesCommitOneCommentAndOneAuditEvent() throws Exception {
        CountDownLatch start = new CountDownLatch(1);
        try (var pool = Executors.newFixedThreadPool(2)) {
            var first = pool.submit(() -> { start.await(); return owner.postJson(route+"/comments", createBody(commentId, anchor, "Retry")); });
            var second = pool.submit(() -> { start.await(); return owner.postJson(route+"/comments", createBody(commentId, anchor, "Retry")); });
            start.countDown();
            assertEquals(201, first.get().statusCode()); assertEquals(201, second.get().statusCode());
        }
        assertEquals(1, owner.json(owner.get(route+"/comments")).size());
        assertEquals(1, owner.json(owner.get(route+"/comments/"+commentId)).path("events").size());
    }
    @Test void databasePreventsAuditAndReplyHistoryMutationAndCrossWorkspaceReferences() throws Exception {
        String thread = create();
        assertEquals(201, owner.postJson(thread+"/replies", json.writeValueAsString(Map.of("id", UUID.randomUUID(), "body", "Reply"))).statusCode());
        assertThrows(Exception.class, () -> jdbc.update("UPDATE comment_audit_events SET action = 'REOPENED'"));
        assertThrows(Exception.class, () -> jdbc.update("DELETE FROM comment_audit_events"));
        assertThrows(Exception.class, () -> jdbc.update("UPDATE comment_replies SET body = 'Changed'"));
        assertThrows(Exception.class, () -> jdbc.update("DELETE FROM comment_replies"));
        assertThrows(Exception.class, () -> jdbc.update("UPDATE document_comments SET workspace_id = ?", UUID.randomUUID()));
        assertThrows(Exception.class, () -> jdbc.update("UPDATE document_comments SET status = 'RESOLVED'"));
    }

    @Test void anAuditFailureRollsBackTheCommentReplyAndStatusChanges() throws Exception {
        jdbc.execute("CREATE FUNCTION fail_review_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Test audit failure'; END; $$");
        try {
            jdbc.execute("CREATE TRIGGER fail_review_audit BEFORE INSERT ON comment_audit_events FOR EACH ROW EXECUTE FUNCTION fail_review_audit()");
            assertEquals(500, editor.postJson(route+"/comments", createBody(commentId, anchor, "Cite the standard?")).statusCode());
            assertEquals(0, jdbc.queryForObject("SELECT count(*) FROM document_comments", Integer.class));
            jdbc.execute("DROP TRIGGER fail_review_audit ON comment_audit_events");
            String thread = create();
            jdbc.execute("CREATE TRIGGER fail_review_audit BEFORE INSERT ON comment_audit_events FOR EACH ROW EXECUTE FUNCTION fail_review_audit()");
            assertEquals(500, owner.patchJson(thread, "{\"status\":\"RESOLVED\"}").statusCode());
            assertEquals("OPEN", viewer.json(viewer.get(thread)).path("comment").path("status").asString());
            assertEquals(500, owner.postJson(thread+"/replies", json.writeValueAsString(Map.of("id", UUID.randomUUID(), "body", "Reply"))).statusCode());
            assertEquals(0, jdbc.queryForObject("SELECT count(*) FROM comment_replies", Integer.class));
            assertEquals(1, viewer.json(viewer.get(thread)).path("events").size());
        } finally {
            jdbc.execute("DROP TRIGGER IF EXISTS fail_review_audit ON comment_audit_events");
            jdbc.execute("DROP FUNCTION fail_review_audit()");
        }
    }
}
