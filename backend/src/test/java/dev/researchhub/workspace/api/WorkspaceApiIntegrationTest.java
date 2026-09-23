package dev.researchhub.workspace.api;

import dev.researchhub.shared.infrastructure.persistence.PostgresTestcontainersConfiguration;
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

import java.net.CookieManager;
import java.net.HttpCookie;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * The workspace endpoints over real HTTP, with two separate signed-in users.
 *
 * <p>Speaks HTTP with a cookie jar rather than using MockMvc, for the reason given in
 * {@code AuthSessionIntegrationTest}: MockMvc cannot carry a session from one call to the next, and the
 * whole question here is what a given signed-in user is allowed to see. Two {@code Browser} instances
 * are two people at two computers.
 *
 * <p>Not {@code @Transactional}: the server handles these requests on its own threads, so a
 * test-managed transaction would be invisible to them. Rows are removed before each test.
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

    /** One browser: a cookie jar plus the CSRF header the SPA sends on mutating calls. */
    private final class Browser {

        private final CookieManager cookies = new CookieManager();
        private final HttpClient http = HttpClient.newBuilder().cookieHandler(cookies).build();

        private URI url(String path) {
            return URI.create("http://localhost:" + port + path);
        }

        HttpResponse<String> get(String path) throws Exception {
            return http.send(HttpRequest.newBuilder(url(path)).GET().build(),
                    HttpResponse.BodyHandlers.ofString());
        }

        HttpResponse<String> postJson(String path, String body) throws Exception {
            get("/api/auth/csrf");
            HttpRequest request = HttpRequest.newBuilder(url(path))
                    .header("Content-Type", "application/json")
                    .header("X-XSRF-TOKEN", cookieValue("XSRF-TOKEN").orElseThrow(
                            () -> new IllegalStateException("No XSRF-TOKEN cookie was issued")))
                    .POST(HttpRequest.BodyPublishers.ofString(body))
                    .build();
            return http.send(request, HttpResponse.BodyHandlers.ofString());
        }

        Optional<String> cookieValue(String name) {
            return cookies.getCookieStore().getCookies().stream()
                    .filter(cookie -> cookie.getName().equals(name))
                    .map(HttpCookie::getValue)
                    .findFirst();
        }

        /** Registers an account and signs in, returning the user's id. */
        String signUp(String email, String displayName) throws Exception {
            HttpResponse<String> registered = postJson("/api/auth/register", """
                    {"email": "%s", "password": "%s", "displayName": "%s"}
                    """.formatted(email, PASSWORD, displayName));
            assertEquals(201, registered.statusCode(), registered.body());

            HttpResponse<String> loggedIn = postJson("/api/auth/login", """
                    {"email": "%s", "password": "%s"}
                    """.formatted(email, PASSWORD));
            assertEquals(200, loggedIn.statusCode(), loggedIn.body());

            return json(registered).get("id").asString();
        }

        HttpResponse<String> createWorkspace(String name, String description) throws Exception {
            return postJson("/api/workspaces", """
                    {"name": "%s", "description": "%s"}
                    """.formatted(name, description));
        }
    }

    private JsonNode json(HttpResponse<String> response) {
        return objectMapper.readTree(response.body());
    }

    @Test
    void createsAWorkspaceOwnedByTheCallerAndListsItBack() throws Exception {
        Browser ada = new Browser();
        String adaId = ada.signUp("ada@example.com", "Ada Lovelace");

        HttpResponse<String> created = ada.createWorkspace("Electronics Lab", "Team 4");

        assertEquals(201, created.statusCode(), created.body());
        JsonNode workspace = json(created);
        assertEquals("Electronics Lab", workspace.get("name").asString());
        assertEquals("Team 4", workspace.get("description").asString());
        assertEquals("OWNER", workspace.get("role").asString(),
                "The creator is the workspace's owner");

        String workspaceId = workspace.get("id").asString();
        assertEquals(1, (int) jdbcTemplate.queryForObject("""
                        SELECT count(*) FROM workspace_members
                        WHERE workspace_id = CAST(? AS uuid) AND user_id = CAST(? AS uuid) AND role = 'OWNER'
                        """, Integer.class, workspaceId, adaId),
                "The owner membership is written as part of creating the workspace");

        HttpResponse<String> listed = ada.get("/api/workspaces");
        assertEquals(200, listed.statusCode(), listed.body());
        assertEquals(1, json(listed).size());
        assertEquals(workspaceId, json(listed).get(0).get("id").asString());
    }

    @Test
    void aWorkspaceIsAbsentFromAnotherUsersList() throws Exception {
        Browser ada = new Browser();
        ada.signUp("ada@example.com", "Ada Lovelace");
        ada.createWorkspace("Electronics Lab", "Team 4");

        Browser kasia = new Browser();
        kasia.signUp("kasia@example.com", "Kasia Nowak");

        HttpResponse<String> kasiasList = kasia.get("/api/workspaces");

        assertEquals(200, kasiasList.statusCode(), kasiasList.body());
        assertEquals(0, json(kasiasList).size(),
                "Kasia belongs to no workspace, so she sees none of Ada's");
    }

    @Test
    void aNonMemberGetsNotFoundRatherThanForbiddenForAWorkspaceTheyCannotSee() throws Exception {
        Browser ada = new Browser();
        ada.signUp("ada@example.com", "Ada Lovelace");
        String workspaceId = json(ada.createWorkspace("Electronics Lab", "Team 4")).get("id").asString();

        Browser kasia = new Browser();
        kasia.signUp("kasia@example.com", "Kasia Nowak");

        HttpResponse<String> hidden = kasia.get("/api/workspaces/" + workspaceId);
        HttpResponse<String> missing = kasia.get("/api/workspaces/" + java.util.UUID.randomUUID());

        assertEquals(404, hidden.statusCode(),
                "A 403 would confirm that another team's workspace exists");
        assertEquals("RESOURCE_NOT_FOUND", json(hidden).get("code").asString());
        assertEquals(missing.statusCode(), hidden.statusCode());
        assertEquals(json(missing).get("detail").asString(), json(hidden).get("detail").asString(),
                "An existing workspace the caller cannot see must read exactly like one that does not exist");
    }

    @Test
    void aMemberCanReadTheWorkspaceById() throws Exception {
        Browser ada = new Browser();
        ada.signUp("ada@example.com", "Ada Lovelace");
        String workspaceId = json(ada.createWorkspace("Electronics Lab", "Team 4")).get("id").asString();

        HttpResponse<String> found = ada.get("/api/workspaces/" + workspaceId);

        assertEquals(200, found.statusCode(), found.body());
        assertEquals(workspaceId, json(found).get("id").asString());
        assertEquals("OWNER", json(found).get("role").asString());
    }

    @Test
    void theOwnerIsTheCallerEvenWhenTheBodyNamesSomebodyElse() throws Exception {
        Browser kasia = new Browser();
        String kasiaId = kasia.signUp("kasia@example.com", "Kasia Nowak");

        Browser ada = new Browser();
        String adaId = ada.signUp("ada@example.com", "Ada Lovelace");

        // A client trying to create a workspace owned by another user. created_by is taken from the
        // session, so the extra field is simply not part of the contract.
        HttpResponse<String> created = ada.postJson("/api/workspaces", """
                {"name": "Smuggled", "description": "", "createdBy": "%s", "role": "VIEWER"}
                """.formatted(kasiaId));

        assertEquals(201, created.statusCode(), created.body());
        String workspaceId = json(created).get("id").asString();

        assertEquals(adaId, jdbcTemplate.queryForObject(
                        "SELECT created_by::text FROM workspaces WHERE id = CAST(? AS uuid)",
                        String.class, workspaceId),
                "created_by must be the authenticated caller, never a field from the body");
        assertEquals("OWNER", json(created).get("role").asString(),
                "The role in the response is the real one, not the one the client asked for");
        assertEquals(0, json(kasia.get("/api/workspaces")).size(),
                "Kasia was named in the body but must not have been given a workspace");
    }

    @Test
    void rejectsAWorkspaceWithNoName() throws Exception {
        Browser ada = new Browser();
        ada.signUp("ada@example.com", "Ada Lovelace");

        HttpResponse<String> response = ada.createWorkspace("   ", "");

        assertEquals(400, response.statusCode(), response.body());
        assertEquals("VALIDATION_FAILED", json(response).get("code").asString());
        assertEquals("name", json(response).get("errors").get(0).get("field").asString(),
                "A whitespace-only name is trimmed before validation and reported as blank");
        assertEquals(0, (int) jdbcTemplate.queryForObject(
                "SELECT count(*) FROM workspaces", Integer.class));
    }

    @Test
    void anonymousCallersAreNotLetIn() throws Exception {
        Browser signedOut = new Browser();

        HttpResponse<String> list = signedOut.get("/api/workspaces");
        assertEquals(401, list.statusCode());
        assertEquals("UNAUTHENTICATED", json(list).get("code").asString());

        HttpResponse<String> one = signedOut.get("/api/workspaces/" + java.util.UUID.randomUUID());
        assertEquals(401, one.statusCode(),
                "An anonymous read must not even learn whether the id exists");

        HttpResponse<String> create = signedOut.createWorkspace("Nope", "");
        assertEquals(401, create.statusCode(), create.body());
        assertEquals(0, (int) jdbcTemplate.queryForObject(
                "SELECT count(*) FROM workspaces", Integer.class));
    }

    @Test
    void creatingAWorkspaceStillRequiresACsrfToken() throws Exception {
        Browser ada = new Browser();
        ada.signUp("ada@example.com", "Ada Lovelace");

        // The session cookie is sent by the cookie jar; the CSRF header is deliberately omitted.
        HttpResponse<String> response = ada.http.send(
                HttpRequest.newBuilder(ada.url("/api/workspaces"))
                        .header("Content-Type", "application/json")
                        .POST(HttpRequest.BodyPublishers.ofString("{\"name\": \"Forged\"}"))
                        .build(),
                HttpResponse.BodyHandlers.ofString());

        assertEquals(403, response.statusCode(), response.body());
        assertEquals("FORBIDDEN", json(response).get("code").asString());
        assertEquals(0, (int) jdbcTemplate.queryForObject(
                        "SELECT count(*) FROM workspaces", Integer.class),
                "A request that cannot prove its origin must not create anything");
    }

    @Test
    void noWorkspaceResponseCarriesUserSecrets() throws Exception {
        Browser ada = new Browser();
        ada.signUp("ada@example.com", "Ada Lovelace");
        HttpResponse<String> created = ada.createWorkspace("Electronics Lab", "Team 4");
        HttpResponse<String> listed = ada.get("/api/workspaces");

        for (String body : new String[]{created.body(), listed.body()}) {
            assertFalse(body.contains(PASSWORD), "A workspace response must never echo a password");
            assertFalse(body.contains("passwordHash"), "nor a hash field");
            assertFalse(body.contains("ada@example.com"),
                    "A workspace is not a place to expose an address; /api/me is the identity read");
        }
        assertTrue(json(listed).get(0).has("role"),
                "The caller's own role is the only membership detail these endpoints return");
    }

}
