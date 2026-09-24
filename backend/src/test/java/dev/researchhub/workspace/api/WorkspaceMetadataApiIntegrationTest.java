package dev.researchhub.workspace.api;

import dev.researchhub.shared.infrastructure.persistence.PostgresTestcontainersConfiguration;
import dev.researchhub.support.ApiBrowser;
import dev.researchhub.workspace.MembershipRowFixture;
import dev.researchhub.workspace.UserRowFixture;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.net.http.HttpResponse;
import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Owner-only metadata edits and the soft archive, over real HTTP.
 *
 * <p>Every role is exercised against both routes, because "only an owner may do this" is a claim about
 * what the other roles cannot do. The {@code EDITOR} and {@code VIEWER} memberships are inserted with SQL:
 * no member-management endpoint exists yet, and waiting for one would mean shipping the rule untested.
 *
 * <p>Not {@code @Transactional}: the server handles these requests on its own threads. Rows are removed
 * before each test.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@ActiveProfiles("local")
@Import(PostgresTestcontainersConfiguration.class)
class WorkspaceMetadataApiIntegrationTest {

    private static final String RENAME_BODY = """
            {"name": "Electronics Lab — Team 4", "description": "Second-year measurements"}
            """;

    @Value("${local.server.port}")
    private int port;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @BeforeEach
    void removeRowsFromPreviousTests() {
        UserRowFixture.deleteWorkspaceAndUserRows(jdbcTemplate);
    }

    private ApiBrowser browser() {
        return new ApiBrowser(port, objectMapper);
    }

    /** An owner with one workspace, ready to be edited. */
    private record Owner(ApiBrowser browser, String userId, String workspaceId) {
    }

    private Owner ownerWithWorkspace() throws Exception {
        ApiBrowser ada = browser();
        String adaId = ada.signUp("ada@example.com", "Ada Lovelace");
        return new Owner(ada, adaId, ada.createdWorkspaceId("Electronics Lab", "Team 4"));
    }

    /** Signs a second user in and gives them {@code role} in the workspace. */
    private ApiBrowser memberWithRole(String workspaceId, String role) throws Exception {
        ApiBrowser member = browser();
        String memberId = member.signUp(role.toLowerCase(java.util.Locale.ROOT) + "@example.com",
                "Team Member");
        MembershipRowFixture.insertMembership(jdbcTemplate, UUID.fromString(workspaceId),
                UUID.fromString(memberId), role);
        return member;
    }

    private int countRows(String table) {
        Integer count = jdbcTemplate.queryForObject("SELECT count(*) FROM " + table, Integer.class);
        return count == null ? 0 : count;
    }

    private String archivedAtColumn(String workspaceId) {
        return jdbcTemplate.queryForObject(
                "SELECT archived_at::text FROM workspaces WHERE id = CAST(? AS uuid)",
                String.class, workspaceId);
    }

    @Test
    void anOwnerCanRenameAndDescribeTheWorkspace() throws Exception {
        Owner ada = ownerWithWorkspace();

        HttpResponse<String> updated = ada.browser().patchJson(
                "/api/workspaces/" + ada.workspaceId(), RENAME_BODY);

        assertEquals(200, updated.statusCode(), updated.body());
        JsonNode body = ada.browser().json(updated);
        assertEquals("Electronics Lab — Team 4", body.get("name").asString());
        assertEquals("Second-year measurements", body.get("description").asString());
        assertEquals("OWNER", body.get("role").asString());
        assertTrue(body.get("archivedAt").isNull(), "Editing does not archive");
        assertNotEquals(body.get("createdAt").asString(), body.get("updatedAt").asString(),
                "updatedAt moves on an edit while createdAt stays put");

        HttpResponse<String> reread = ada.browser().get("/api/workspaces/" + ada.workspaceId());
        assertEquals("Electronics Lab — Team 4", ada.browser().json(reread).get("name").asString(),
                "The change was persisted, not just echoed");
    }

    @Test
    void anOwnerCanClearTheDescription() throws Exception {
        Owner ada = ownerWithWorkspace();

        HttpResponse<String> updated = ada.browser().patchJson("/api/workspaces/" + ada.workspaceId(),
                """
                        {"name": "Electronics Lab", "description": "   "}
                        """);

        assertEquals(200, updated.statusCode(), updated.body());
        assertTrue(ada.browser().json(updated).get("description").isNull(),
                "A blank description is stored as absent, the same normalization create performs");
        assertNull(jdbcTemplate.queryForObject(
                "SELECT description FROM workspaces WHERE id = CAST(? AS uuid)",
                String.class, ada.workspaceId()));
    }

    @Test
    void aRenameToABlankNameIsRejectedAsAFieldError() throws Exception {
        Owner ada = ownerWithWorkspace();

        HttpResponse<String> rejected = ada.browser().patchJson("/api/workspaces/" + ada.workspaceId(),
                """
                        {"name": "   ", "description": "Team 4"}
                        """);

        assertEquals(400, rejected.statusCode(), rejected.body());
        assertEquals("VALIDATION_FAILED", ada.browser().json(rejected).get("code").asString());
        assertEquals("name", ada.browser().json(rejected).get("errors").get(0).get("field").asString());
        assertEquals("Electronics Lab", jdbcTemplate.queryForObject(
                        "SELECT name FROM workspaces WHERE id = CAST(? AS uuid)",
                        String.class, ada.workspaceId()),
                "A rejected edit changes nothing");
    }

    @Test
    void anEditorIsForbiddenFromEditingOrArchiving() throws Exception {
        Owner ada = ownerWithWorkspace();
        ApiBrowser editor = memberWithRole(ada.workspaceId(), "EDITOR");

        HttpResponse<String> patch = editor.patchJson("/api/workspaces/" + ada.workspaceId(), RENAME_BODY);
        HttpResponse<String> archive = editor.postJson(
                "/api/workspaces/" + ada.workspaceId() + "/archive", "");

        assertEquals(403, patch.statusCode(), patch.body());
        assertEquals("FORBIDDEN", editor.json(patch).get("code").asString());
        assertEquals(403, archive.statusCode(), archive.body());
        assertEquals("FORBIDDEN", editor.json(archive).get("code").asString());

        assertEquals(200, editor.get("/api/workspaces/" + ada.workspaceId()).statusCode(),
                "An editor is still a member, so the workspace is not hidden from them — only closed");
        assertEquals("Electronics Lab", jdbcTemplate.queryForObject(
                "SELECT name FROM workspaces WHERE id = CAST(? AS uuid)", String.class, ada.workspaceId()));
        assertNull(archivedAtColumn(ada.workspaceId()), "and nothing was archived");
    }

    @Test
    void aViewerIsForbiddenFromEditingOrArchiving() throws Exception {
        Owner ada = ownerWithWorkspace();
        ApiBrowser viewer = memberWithRole(ada.workspaceId(), "VIEWER");

        assertEquals(403, viewer.patchJson("/api/workspaces/" + ada.workspaceId(), RENAME_BODY)
                .statusCode());
        assertEquals(403, viewer.postJson("/api/workspaces/" + ada.workspaceId() + "/archive", "")
                .statusCode());
        assertNull(archivedAtColumn(ada.workspaceId()));
    }

    /**
     * A non-member gets the not-found answer, not the forbidden one.
     *
     * <p>The difference matters: {@code 403} would confirm that this workspace exists to someone with no
     * business knowing, so every route has to agree with {@code GET /api/workspaces/{id}}.
     */
    @Test
    void aNonMemberGetsTheSameNotFoundAsARandomIdForBothRoutes() throws Exception {
        Owner ada = ownerWithWorkspace();

        ApiBrowser outsider = browser();
        outsider.signUp("outsider@example.com", "Outsider");
        String randomId = UUID.randomUUID().toString();

        HttpResponse<String> patchReal = outsider.patchJson(
                "/api/workspaces/" + ada.workspaceId(), RENAME_BODY);
        HttpResponse<String> patchRandom = outsider.patchJson("/api/workspaces/" + randomId, RENAME_BODY);
        HttpResponse<String> archiveReal = outsider.postJson(
                "/api/workspaces/" + ada.workspaceId() + "/archive", "");
        HttpResponse<String> archiveRandom = outsider.postJson(
                "/api/workspaces/" + randomId + "/archive", "");

        for (HttpResponse<String> response : List.of(patchReal, patchRandom, archiveReal, archiveRandom)) {
            assertEquals(404, response.statusCode(), response.body());
            assertEquals("RESOURCE_NOT_FOUND", outsider.json(response).get("code").asString());
        }
        assertEquals(outsider.json(patchRandom).get("detail").asString(),
                outsider.json(patchReal).get("detail").asString(),
                "PATCH on someone else's workspace must read like PATCH on nothing at all");
        assertEquals(outsider.json(archiveRandom).get("detail").asString(),
                outsider.json(archiveReal).get("detail").asString());

        assertEquals("Electronics Lab", jdbcTemplate.queryForObject(
                "SELECT name FROM workspaces WHERE id = CAST(? AS uuid)", String.class, ada.workspaceId()));
        assertNull(archivedAtColumn(ada.workspaceId()));
    }

    @Test
    void anonymousCallersCannotEditOrArchive() throws Exception {
        Owner ada = ownerWithWorkspace();
        ApiBrowser signedOut = browser();

        HttpResponse<String> patch = signedOut.patchJson(
                "/api/workspaces/" + ada.workspaceId(), RENAME_BODY);
        HttpResponse<String> archive = signedOut.postJson(
                "/api/workspaces/" + ada.workspaceId() + "/archive", "");

        assertEquals(401, patch.statusCode(), patch.body());
        assertEquals("UNAUTHENTICATED", signedOut.json(patch).get("code").asString());
        assertEquals(401, archive.statusCode(), archive.body());
        assertNull(archivedAtColumn(ada.workspaceId()));
    }

    @Test
    void editingAndArchivingStillRequireACsrfToken() throws Exception {
        Owner ada = ownerWithWorkspace();

        HttpResponse<String> patch = ada.browser().sendWithoutCsrf(
                "PATCH", "/api/workspaces/" + ada.workspaceId(), RENAME_BODY);
        HttpResponse<String> archive = ada.browser().sendWithoutCsrf(
                "POST", "/api/workspaces/" + ada.workspaceId() + "/archive", "");

        assertEquals(403, patch.statusCode(), patch.body());
        assertEquals("FORBIDDEN", ada.browser().json(patch).get("code").asString());
        assertEquals(403, archive.statusCode(), archive.body());
        assertEquals("Electronics Lab", jdbcTemplate.queryForObject(
                "SELECT name FROM workspaces WHERE id = CAST(? AS uuid)", String.class, ada.workspaceId()));
        assertNull(archivedAtColumn(ada.workspaceId()),
                "A request that cannot prove its origin must not change state");
    }

    /**
     * The central RH-053 behaviour: archiving retires a workspace without destroying anything.
     */
    @Test
    void archivingRemovesTheWorkspaceFromTheListButKeepsEveryRow() throws Exception {
        Owner ada = ownerWithWorkspace();
        ApiBrowser viewer = memberWithRole(ada.workspaceId(), "VIEWER");
        int membershipsBefore = countRows("workspace_members");

        HttpResponse<String> archived = ada.browser().postJson(
                "/api/workspaces/" + ada.workspaceId() + "/archive", "");

        assertEquals(200, archived.statusCode(), archived.body());
        assertFalse(ada.browser().json(archived).get("archivedAt").isNull(),
                "The response says when it was archived");

        assertEquals("[]", ada.browser().get("/api/workspaces").body(),
                "An archived workspace leaves the owner's list");
        assertEquals("[]", viewer.get("/api/workspaces").body(),
                "and every other member's list too");

        HttpResponse<String> stillReadable = ada.browser().get("/api/workspaces/" + ada.workspaceId());
        assertEquals(200, stillReadable.statusCode(),
                "Members can still open an archived workspace; its history has not gone anywhere");
        assertFalse(ada.browser().json(stillReadable).get("archivedAt").isNull());
        assertEquals(200, viewer.get("/api/workspaces/" + ada.workspaceId()).statusCode(),
                "A viewer keeps their read access after archiving");

        assertEquals(1, countRows("workspaces"), "The workspace row still exists");
        assertEquals(membershipsBefore, countRows("workspace_members"),
                "Archiving removes no membership: nobody is thrown out of a workspace by retiring it");
        assertEquals(ada.userId(), jdbcTemplate.queryForObject(
                        "SELECT archived_by::text FROM workspaces WHERE id = CAST(? AS uuid)",
                        String.class, ada.workspaceId()),
                "archived_by records who did it, for audit, without the API exposing a profile");
        assertFalse(archived.body().contains("archivedBy"),
                "archived_by is not part of the response contract");
    }

    @Test
    void aNonMemberStillCannotSeeAnArchivedWorkspace() throws Exception {
        Owner ada = ownerWithWorkspace();
        ada.browser().postJson("/api/workspaces/" + ada.workspaceId() + "/archive", "");

        ApiBrowser outsider = browser();
        outsider.signUp("outsider@example.com", "Outsider");

        HttpResponse<String> response = outsider.get("/api/workspaces/" + ada.workspaceId());

        assertEquals(404, response.statusCode(),
                "Archiving does not change who the workspace is hidden from");
        assertEquals("RESOURCE_NOT_FOUND", outsider.json(response).get("code").asString());
    }

    @Test
    void archivingTwiceKeepsTheFirstTimestamp() throws Exception {
        Owner ada = ownerWithWorkspace();

        HttpResponse<String> first = ada.browser().postJson(
                "/api/workspaces/" + ada.workspaceId() + "/archive", "");
        String firstArchivedAt = ada.browser().json(first).get("archivedAt").asString();

        HttpResponse<String> second = ada.browser().postJson(
                "/api/workspaces/" + ada.workspaceId() + "/archive", "");

        assertEquals(200, second.statusCode(), second.body());
        assertEquals(firstArchivedAt, ada.browser().json(second).get("archivedAt").asString(),
                "A retried archive returns the current state and does not rewrite when it happened");
        assertEquals(1, countRows("workspaces"));
    }

    @Test
    void editingAnArchivedWorkspaceIsAConflict() throws Exception {
        Owner ada = ownerWithWorkspace();
        ada.browser().postJson("/api/workspaces/" + ada.workspaceId() + "/archive", "");

        HttpResponse<String> rejected = ada.browser().patchJson(
                "/api/workspaces/" + ada.workspaceId(), RENAME_BODY);

        assertEquals(409, rejected.statusCode(), rejected.body());
        assertEquals("CONFLICT", ada.browser().json(rejected).get("code").asString());
        assertEquals("Electronics Lab", jdbcTemplate.queryForObject(
                        "SELECT name FROM workspaces WHERE id = CAST(? AS uuid)",
                        String.class, ada.workspaceId()),
                "The archived workspace keeps the name it had");
    }

    /**
     * There is no hard delete, and this pins that down rather than trusting that nobody added one.
     *
     * <p>Sent with a valid CSRF token and a real owner session, so the refusal is about the route not
     * existing, not about the request being rejected earlier for some unrelated reason.
     */
    @Test
    void thereIsNoDeleteRoute() throws Exception {
        Owner ada = ownerWithWorkspace();

        HttpResponse<String> response = ada.browser().delete("/api/workspaces/" + ada.workspaceId());

        assertTrue(response.statusCode() >= 400,
                "Hard delete is out of scope: history has to stay traceable, so archiving is the only exit. "
                        + "Status was " + response.statusCode());
        assertEquals(1, countRows("workspaces"), "and the row is still there");
        assertEquals(1, countRows("workspace_members"));
    }

}
