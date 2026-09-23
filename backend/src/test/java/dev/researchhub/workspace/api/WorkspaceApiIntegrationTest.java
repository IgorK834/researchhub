package dev.researchhub.workspace.api;

import dev.researchhub.shared.infrastructure.persistence.PostgresTestcontainersConfiguration;
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
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Creating, listing, and reading workspaces over real HTTP, with separate signed-in users.
 *
 * <p>The isolation tests here are the point of the whole feature: a workspace is a security boundary, and
 * the only evidence that it is one is that a second real session cannot see through it. Each
 * {@link ApiBrowser} is one person with their own cookie jar.
 *
 * <p>Not {@code @Transactional}: the server handles these requests on its own threads, so a test-managed
 * transaction would be invisible to them. Rows are removed before each test.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@ActiveProfiles("local")
@Import(PostgresTestcontainersConfiguration.class)
class WorkspaceApiIntegrationTest {

    private static final String PASSWORD = "correct-horse-battery-staple";

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

    private List<String> workspaceIdsIn(HttpResponse<String> listResponse) {
        JsonNode body = objectMapper.readTree(listResponse.body());
        List<String> ids = new ArrayList<>();
        for (int index = 0; index < body.size(); index++) {
            ids.add(body.get(index).get("id").asString());
        }
        return ids;
    }

    @Test
    void createsAWorkspaceOwnedByTheCallerAndListsItBack() throws Exception {
        ApiBrowser ada = browser();
        String adaId = ada.signUp("ada@example.com", "Ada Lovelace");

        HttpResponse<String> created = ada.createWorkspace("Electronics Lab", "Team 4");

        assertEquals(201, created.statusCode(), created.body());
        JsonNode workspace = ada.json(created);
        assertEquals("Electronics Lab", workspace.get("name").asString());
        assertEquals("Team 4", workspace.get("description").asString());
        assertEquals("OWNER", workspace.get("role").asString(), "The creator is the workspace's owner");
        assertTrue(workspace.get("archivedAt").isNull(), "A new workspace is active");

        String workspaceId = workspace.get("id").asString();
        assertEquals(1, (int) jdbcTemplate.queryForObject("""
                        SELECT count(*) FROM workspace_members
                        WHERE workspace_id = CAST(? AS uuid) AND user_id = CAST(? AS uuid) AND role = 'OWNER'
                        """, Integer.class, workspaceId, adaId),
                "The owner membership is written as part of creating the workspace");

        HttpResponse<String> listed = ada.get("/api/workspaces");
        assertEquals(200, listed.statusCode(), listed.body());
        assertEquals(List.of(workspaceId), workspaceIdsIn(listed));
    }

    /**
     * The RH-052 acceptance test: two users, two workspaces, and neither can reach the other's.
     *
     * <p>Symmetric on purpose. A one-directional check would pass even if visibility leaked in the other
     * direction — for instance if a list were scoped by {@code created_by} rather than by membership,
     * which happens to be the same thing for the creator and nothing like it for anyone else.
     */
    @Test
    void twoUsersEachSeeOnlyTheirOwnWorkspace() throws Exception {
        ApiBrowser ada = browser();
        ada.signUp("ada@example.com", "Ada Lovelace");
        String adasWorkspace = ada.createdWorkspaceId("Ada's lab", "Electronics");

        ApiBrowser kasia = browser();
        kasia.signUp("kasia@example.com", "Kasia Nowak");
        String kasiasWorkspace = kasia.createdWorkspaceId("Kasia's lab", "Chemistry");

        assertEquals(List.of(adasWorkspace), workspaceIdsIn(ada.get("/api/workspaces")),
                "Ada's list contains her workspace and only hers");
        assertEquals(List.of(kasiasWorkspace), workspaceIdsIn(kasia.get("/api/workspaces")),
                "Kasia's list contains her workspace and only hers");

        HttpResponse<String> adaReadingKasias = ada.get("/api/workspaces/" + kasiasWorkspace);
        HttpResponse<String> kasiaReadingAdas = kasia.get("/api/workspaces/" + adasWorkspace);
        HttpResponse<String> nonexistent = ada.get("/api/workspaces/" + UUID.randomUUID());

        assertEquals(404, adaReadingKasias.statusCode(), "Ada is not a member of Kasia's workspace");
        assertEquals(404, kasiaReadingAdas.statusCode(), "and Kasia is not a member of Ada's");
        assertEquals("RESOURCE_NOT_FOUND", ada.json(adaReadingKasias).get("code").asString());
        assertEquals("RESOURCE_NOT_FOUND", kasia.json(kasiaReadingAdas).get("code").asString());
        assertEquals(ada.json(nonexistent).get("detail").asString(),
                ada.json(adaReadingKasias).get("detail").asString(),
                "A workspace that exists but is not yours must read exactly like one that does not exist");
    }

    /**
     * Membership is what grants visibility — not ownership, and not anything the client sends.
     *
     * <p>The {@code VIEWER} row is inserted with SQL because no member-management endpoint exists yet. That
     * is the whole reason this test is worth writing now: it shows the read path already honours a role it
     * has no way to create, so the endpoint that will create one has nothing left to get wrong.
     */
    @Test
    void aMembershipGrantsVisibilityWithTheRoleItCarries() throws Exception {
        ApiBrowser ada = browser();
        ada.signUp("ada@example.com", "Ada Lovelace");
        String workspaceId = ada.createdWorkspaceId("Electronics Lab", "Team 4");

        ApiBrowser kasia = browser();
        String kasiaId = kasia.signUp("kasia@example.com", "Kasia Nowak");

        assertEquals(List.of(), workspaceIdsIn(kasia.get("/api/workspaces")),
                "Before the membership exists, Kasia sees nothing");
        assertEquals(404, kasia.get("/api/workspaces/" + workspaceId).statusCode());

        MembershipRowFixture.insertMembership(jdbcTemplate, UUID.fromString(workspaceId),
                UUID.fromString(kasiaId), "VIEWER");

        assertEquals(List.of(workspaceId), workspaceIdsIn(kasia.get("/api/workspaces")),
                "The membership alone makes the workspace visible");

        HttpResponse<String> kasiasRead = kasia.get("/api/workspaces/" + workspaceId);
        assertEquals(200, kasiasRead.statusCode(), kasiasRead.body());
        assertEquals("VIEWER", kasia.json(kasiasRead).get("role").asString(),
                "Kasia sees the role her membership carries");

        HttpResponse<String> adasRead = ada.get("/api/workspaces/" + workspaceId);
        assertEquals("OWNER", ada.json(adasRead).get("role").asString(),
                "and Ada still sees her own role, not Kasia's");
        assertEquals(ada.json(adasRead).get("name").asString(),
                kasia.json(kasiasRead).get("name").asString(),
                "Both see the same workspace; only the role differs");
    }

    @Test
    void aMemberCanReadTheWorkspaceById() throws Exception {
        ApiBrowser ada = browser();
        ada.signUp("ada@example.com", "Ada Lovelace");
        String workspaceId = ada.createdWorkspaceId("Electronics Lab", "Team 4");

        HttpResponse<String> found = ada.get("/api/workspaces/" + workspaceId);

        assertEquals(200, found.statusCode(), found.body());
        assertEquals(workspaceId, ada.json(found).get("id").asString());
        assertEquals("OWNER", ada.json(found).get("role").asString());
    }

    @Test
    void theOwnerIsTheCallerEvenWhenTheBodyNamesSomebodyElse() throws Exception {
        ApiBrowser kasia = browser();
        String kasiaId = kasia.signUp("kasia@example.com", "Kasia Nowak");

        ApiBrowser ada = browser();
        String adaId = ada.signUp("ada@example.com", "Ada Lovelace");

        // A client trying to create a workspace owned by another user. created_by is taken from the
        // session, so the extra field is simply not part of the contract.
        HttpResponse<String> created = ada.postJson("/api/workspaces", """
                {"name": "Smuggled", "description": "", "createdBy": "%s", "role": "VIEWER"}
                """.formatted(kasiaId));

        assertEquals(201, created.statusCode(), created.body());
        String workspaceId = ada.json(created).get("id").asString();

        assertEquals(adaId, jdbcTemplate.queryForObject(
                        "SELECT created_by::text FROM workspaces WHERE id = CAST(? AS uuid)",
                        String.class, workspaceId),
                "created_by must be the authenticated caller, never a field from the body");
        assertEquals("OWNER", ada.json(created).get("role").asString(),
                "The role in the response is the real one, not the one the client asked for");
        assertEquals(List.of(), workspaceIdsIn(kasia.get("/api/workspaces")),
                "Kasia was named in the body but must not have been given a workspace");
    }

    @Test
    void rejectsAWorkspaceWithNoName() throws Exception {
        ApiBrowser ada = browser();
        ada.signUp("ada@example.com", "Ada Lovelace");

        HttpResponse<String> response = ada.createWorkspace("   ", "");

        assertEquals(400, response.statusCode(), response.body());
        assertEquals("VALIDATION_FAILED", ada.json(response).get("code").asString());
        assertEquals("name", ada.json(response).get("errors").get(0).get("field").asString(),
                "A whitespace-only name is trimmed before validation and reported as blank");
        assertEquals(0, (int) jdbcTemplate.queryForObject(
                "SELECT count(*) FROM workspaces", Integer.class));
    }

    @Test
    void anonymousCallersAreNotLetIn() throws Exception {
        ApiBrowser signedOut = browser();

        HttpResponse<String> list = signedOut.get("/api/workspaces");
        assertEquals(401, list.statusCode());
        assertEquals("UNAUTHENTICATED", signedOut.json(list).get("code").asString());

        HttpResponse<String> one = signedOut.get("/api/workspaces/" + UUID.randomUUID());
        assertEquals(401, one.statusCode(),
                "An anonymous read must not even learn whether the id exists");

        HttpResponse<String> create = signedOut.createWorkspace("Nope", "");
        assertEquals(401, create.statusCode(), create.body());
        assertEquals(0, (int) jdbcTemplate.queryForObject(
                "SELECT count(*) FROM workspaces", Integer.class));
    }

    @Test
    void creatingAWorkspaceStillRequiresACsrfToken() throws Exception {
        ApiBrowser ada = browser();
        ada.signUp("ada@example.com", "Ada Lovelace");

        HttpResponse<String> response = ada.sendWithoutCsrf("POST", "/api/workspaces",
                "{\"name\": \"Forged\"}");

        assertEquals(403, response.statusCode(), response.body());
        assertEquals("FORBIDDEN", ada.json(response).get("code").asString());
        assertEquals(0, (int) jdbcTemplate.queryForObject(
                        "SELECT count(*) FROM workspaces", Integer.class),
                "A request that cannot prove its origin must not create anything");
    }

    @Test
    void noWorkspaceResponseCarriesUserSecrets() throws Exception {
        ApiBrowser ada = browser();
        ada.signUp("ada@example.com", "Ada Lovelace");
        HttpResponse<String> created = ada.createWorkspace("Electronics Lab", "Team 4");
        HttpResponse<String> listed = ada.get("/api/workspaces");

        for (String body : new String[]{created.body(), listed.body()}) {
            assertFalse(body.contains(PASSWORD), "A workspace response must never echo a password");
            assertFalse(body.contains("passwordHash"), "nor a hash field");
            assertFalse(body.contains("ada@example.com"),
                    "A workspace is not a place to expose an address; /api/me is the identity read");
        }
        assertTrue(ada.json(listed).get(0).has("role"),
                "The caller's own role is the only membership detail these endpoints return");
    }

}
