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

import java.net.http.HttpResponse;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Membership management over real HTTP, with a separate signed-in session per person.
 *
 * <p>This is where the roles stop being a table in the domain and start being what one account can do to
 * another's access. Each {@link ApiBrowser} is one person, so "an editor cannot remove anyone" is asserted as
 * an editor, with their own session and CSRF token, rather than by calling a service method.
 *
 * <p>Not {@code @Transactional}: the server handles these requests on its own threads. Rows are removed
 * before each test.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@ActiveProfiles("local")
@Import(PostgresTestcontainersConfiguration.class)
class WorkspaceMemberApiIntegrationTest {

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

    /** An owner, their workspace, and the browser they are signed in with. */
    private record Owner(ApiBrowser browser, String userId, String workspaceId) {
    }

    private Owner ownerWithWorkspace() throws Exception {
        ApiBrowser ada = browser();
        String adaId = ada.signUp("ada@example.com", "Ada Lovelace");
        return new Owner(ada, adaId, ada.createdWorkspaceId("Electronics Lab", "Team 4"));
    }

    /** A second registered user who is not a member of anything yet. */
    private record Person(ApiBrowser browser, String userId, String email) {
    }

    private Person register(String email, String displayName) throws Exception {
        ApiBrowser person = browser();
        return new Person(person, person.signUp(email, displayName), email);
    }

    private String membersPath(String workspaceId) {
        return "/api/workspaces/" + workspaceId + "/members";
    }

    private String addBody(String email, String role) {
        return """
                {"email": "%s", "role": "%s"}
                """.formatted(email, role);
    }

    private String roleBody(String role) {
        return """
                {"role": "%s"}
                """.formatted(role);
    }

    private List<String> rolesByUserId(HttpResponse<String> listResponse, String userId) {
        JsonNode body = objectMapper.readTree(listResponse.body());
        List<String> roles = new ArrayList<>();
        for (int index = 0; index < body.size(); index++) {
            if (body.get(index).get("userId").asString().equals(userId)) {
                roles.add(body.get(index).get("role").asString());
            }
        }
        return roles;
    }

    private int countMemberships(String workspaceId) {
        Integer count = jdbcTemplate.queryForObject(
                "SELECT count(*) FROM workspace_members WHERE workspace_id = CAST(? AS uuid)",
                Integer.class, workspaceId);
        return count == null ? 0 : count;
    }

    // --- RH-054: adding a member ---

    @Test
    void anOwnerAddsARegisteredUserAsEditorAndTheyGainAccess() throws Exception {
        Owner ada = ownerWithWorkspace();
        Person kasia = register("kasia@example.com", "Kasia Nowak");

        assertEquals(404, kasia.browser().get("/api/workspaces/" + ada.workspaceId()).statusCode(),
                "Before the add, the workspace is not even visible to her");

        HttpResponse<String> added = ada.browser().postJson(membersPath(ada.workspaceId()),
                addBody(kasia.email(), "EDITOR"));

        assertEquals(201, added.statusCode(), added.body());
        JsonNode member = ada.browser().json(added);
        assertEquals(kasia.userId(), member.get("userId").asString());
        assertEquals("kasia@example.com", member.get("email").asString());
        assertEquals("Kasia Nowak", member.get("displayName").asString());
        assertEquals("EDITOR", member.get("role").asString());

        // The point of the whole feature: her own next request now sees the workspace.
        HttpResponse<String> herWorkspace = kasia.browser().get("/api/workspaces/" + ada.workspaceId());
        assertEquals(200, herWorkspace.statusCode(), herWorkspace.body());
        assertEquals("EDITOR", kasia.browser().json(herWorkspace).get("role").asString());
        assertTrue(kasia.browser().get("/api/workspaces").body().contains(ada.workspaceId()),
                "and it appears in her workspace list");
    }

    @Test
    void anAddressWithNoAccountIsNotFoundAndCreatesNothing() throws Exception {
        Owner ada = ownerWithWorkspace();

        HttpResponse<String> response = ada.browser().postJson(membersPath(ada.workspaceId()),
                addBody("nobody@example.com", "EDITOR"));

        assertEquals(404, response.statusCode(), response.body());
        assertEquals("RESOURCE_NOT_FOUND", ada.browser().json(response).get("code").asString());
        assertEquals("No registered user has that email",
                ada.browser().json(response).get("detail").asString(),
                "One stable message, with no offer to invite an address that has no account");
        assertEquals(1, countMemberships(ada.workspaceId()), "Only the owner's own membership exists");
    }

    /**
     * A disabled account and an unknown address must be indistinguishable, or this endpoint tells anyone
     * with a workspace which addresses are registered here.
     */
    @Test
    void aDisabledAccountLooksExactlyLikeAnUnknownAddress() throws Exception {
        Owner ada = ownerWithWorkspace();
        Person disabled = register("disabled@example.com", "Disabled Account");
        jdbcTemplate.update("UPDATE users SET status = 'DISABLED' WHERE id = CAST(? AS uuid)",
                disabled.userId());

        HttpResponse<String> disabledAttempt = ada.browser().postJson(membersPath(ada.workspaceId()),
                addBody("disabled@example.com", "VIEWER"));
        HttpResponse<String> unknownAttempt = ada.browser().postJson(membersPath(ada.workspaceId()),
                addBody("nobody@example.com", "VIEWER"));

        assertEquals(unknownAttempt.statusCode(), disabledAttempt.statusCode());
        assertEquals(ada.browser().json(unknownAttempt).get("detail").asString(),
                ada.browser().json(disabledAttempt).get("detail").asString());
        assertEquals(1, countMemberships(ada.workspaceId()));
    }

    @Test
    void addingSomebodyTwiceIsAConflictEvenWithADifferentlyTypedAddress() throws Exception {
        Owner ada = ownerWithWorkspace();
        register("kasia@example.com", "Kasia Nowak");
        ada.browser().postJson(membersPath(ada.workspaceId()), addBody("kasia@example.com", "EDITOR"));

        HttpResponse<String> again = ada.browser().postJson(membersPath(ada.workspaceId()),
                addBody("  KASIA@Example.COM  ", "VIEWER"));

        assertEquals(409, again.statusCode(), again.body());
        assertEquals("CONFLICT", ada.browser().json(again).get("code").asString());
        assertEquals(2, countMemberships(ada.workspaceId()), "No second row");
        assertEquals(List.of("EDITOR"),
                rolesByUserId(ada.browser().get(membersPath(ada.workspaceId())),
                        findUserId(ada, "kasia@example.com")),
                "and the role she was given was not overwritten by the second attempt");
    }

    /** Finds a member's user id from the roster, so a test can assert on their row without a fixture. */
    private String findUserId(Owner owner, String email) throws Exception {
        JsonNode body = objectMapper.readTree(owner.browser().get(membersPath(owner.workspaceId())).body());
        for (int index = 0; index < body.size(); index++) {
            if (body.get(index).get("email").asString().equals(email)) {
                return body.get(index).get("userId").asString();
            }
        }
        throw new AssertionError(email + " is not a member");
    }

    @Test
    void theOwnerCannotAddThemselvesAgain() throws Exception {
        Owner ada = ownerWithWorkspace();

        HttpResponse<String> response = ada.browser().postJson(membersPath(ada.workspaceId()),
                addBody("ada@example.com", "EDITOR"));

        assertEquals(409, response.statusCode(), response.body());
        assertEquals(1, countMemberships(ada.workspaceId()),
                "and their OWNER membership is untouched rather than downgraded");
        assertEquals(List.of("OWNER"),
                rolesByUserId(ada.browser().get(membersPath(ada.workspaceId())), ada.userId()));
    }

    @Test
    void aNewMemberCannotBeAddedAsOwner() throws Exception {
        Owner ada = ownerWithWorkspace();
        register("kasia@example.com", "Kasia Nowak");

        HttpResponse<String> response = ada.browser().postJson(membersPath(ada.workspaceId()),
                addBody("kasia@example.com", "OWNER"));

        assertEquals(400, response.statusCode(), response.body());
        assertEquals("VALIDATION_FAILED", ada.browser().json(response).get("code").asString());
        assertEquals("role", ada.browser().json(response).get("errors").get(0).get("field").asString(),
                "Reported on the field the client got wrong");
        assertEquals(1, countMemberships(ada.workspaceId()));
    }

    @Test
    void anUnknownRoleIsRejected() throws Exception {
        Owner ada = ownerWithWorkspace();
        register("kasia@example.com", "Kasia Nowak");

        HttpResponse<String> response = ada.browser().postJson(membersPath(ada.workspaceId()),
                addBody("kasia@example.com", "ADMIN"));

        assertEquals(400, response.statusCode(), response.body());
        assertEquals(1, countMemberships(ada.workspaceId()));
    }

    // --- RH-055: the roster, and who may change it ---

    @Test
    void everyMemberCanSeeTheRosterAndItCarriesNoSecrets() throws Exception {
        Owner ada = ownerWithWorkspace();
        Person kasia = register("kasia@example.com", "Kasia Nowak");
        ada.browser().postJson(membersPath(ada.workspaceId()), addBody(kasia.email(), "VIEWER"));

        HttpResponse<String> asViewer = kasia.browser().get(membersPath(ada.workspaceId()));

        assertEquals(200, asViewer.statusCode(), asViewer.body());
        JsonNode roster = kasia.browser().json(asViewer);
        assertEquals(2, roster.size(), "A viewer sees everyone, they just cannot change anything");

        for (int index = 0; index < roster.size(); index++) {
            JsonNode member = roster.get(index);
            assertEquals(4, member.size(),
                    "Exactly userId, email, displayName, role — nothing else: " + member);
            assertTrue(member.has("userId") && member.has("email")
                    && member.has("displayName") && member.has("role"));
        }
        String body = asViewer.body();
        assertFalse(body.contains("password"), "no password field of any kind");
        assertFalse(body.contains("passwordHash"));
        assertFalse(body.contains("normalizedEmail"));
        assertFalse(body.contains("ACTIVE"), "and no account status");
        assertFalse(body.contains(PASSWORD));
    }

    @Test
    void aNonMemberCannotSeeTheRosterAndGetsTheSame404AsARandomId() throws Exception {
        Owner ada = ownerWithWorkspace();
        Person outsider = register("outsider@example.com", "Outsider");
        String randomId = UUID.randomUUID().toString();

        HttpResponse<String> real = outsider.browser().get(membersPath(ada.workspaceId()));
        HttpResponse<String> random = outsider.browser().get(membersPath(randomId));

        assertEquals(404, real.statusCode());
        assertEquals("RESOURCE_NOT_FOUND", outsider.browser().json(real).get("code").asString());
        assertEquals(outsider.browser().json(random).get("detail").asString(),
                outsider.browser().json(real).get("detail").asString(),
                "The roster of a workspace you are not in must read like a workspace that does not exist");
    }

    @Test
    void anEditorCannotAddChangeOrRemoveMembers() throws Exception {
        Owner ada = ownerWithWorkspace();
        Person kasia = register("kasia@example.com", "Kasia Nowak");
        Person michal = register("michal@example.com", "Michal Kowalski");
        ada.browser().postJson(membersPath(ada.workspaceId()), addBody(kasia.email(), "EDITOR"));
        ada.browser().postJson(membersPath(ada.workspaceId()), addBody(michal.email(), "VIEWER"));

        HttpResponse<String> add = kasia.browser().postJson(membersPath(ada.workspaceId()),
                addBody("someone-else@example.com", "VIEWER"));
        HttpResponse<String> patch = kasia.browser().patchJson(
                membersPath(ada.workspaceId()) + "/" + michal.userId(), roleBody("EDITOR"));
        HttpResponse<String> delete = kasia.browser().delete(
                membersPath(ada.workspaceId()) + "/" + michal.userId());

        for (HttpResponse<String> response : List.of(add, patch, delete)) {
            assertEquals(403, response.statusCode(), response.body());
            assertEquals("FORBIDDEN", kasia.browser().json(response).get("code").asString());
        }
        assertEquals(3, countMemberships(ada.workspaceId()), "Nothing was added or removed");
        assertEquals(List.of("VIEWER"),
                rolesByUserId(ada.browser().get(membersPath(ada.workspaceId())), michal.userId()),
                "and no role was changed");
    }

    @Test
    void aViewerCannotChangeOrRemoveMembers() throws Exception {
        Owner ada = ownerWithWorkspace();
        Person michal = register("michal@example.com", "Michal Kowalski");
        ada.browser().postJson(membersPath(ada.workspaceId()), addBody(michal.email(), "VIEWER"));

        assertEquals(403, michal.browser().patchJson(
                membersPath(ada.workspaceId()) + "/" + ada.userId(), roleBody("VIEWER")).statusCode(),
                "A viewer must not be able to demote the owner");
        assertEquals(403, michal.browser().delete(
                membersPath(ada.workspaceId()) + "/" + ada.userId()).statusCode());
        assertEquals(List.of("OWNER"),
                rolesByUserId(ada.browser().get(membersPath(ada.workspaceId())), ada.userId()));
    }

    @Test
    void anonymousCallersCannotReadOrChangeTheRoster() throws Exception {
        Owner ada = ownerWithWorkspace();
        ApiBrowser signedOut = browser();

        HttpResponse<String> list = signedOut.get(membersPath(ada.workspaceId()));
        HttpResponse<String> add = signedOut.postJson(membersPath(ada.workspaceId()),
                addBody("kasia@example.com", "EDITOR"));
        HttpResponse<String> delete = signedOut.delete(
                membersPath(ada.workspaceId()) + "/" + ada.userId());

        assertEquals(401, list.statusCode());
        assertEquals("UNAUTHENTICATED", signedOut.json(list).get("code").asString());
        assertEquals(401, add.statusCode(), add.body());
        assertEquals(401, delete.statusCode(), delete.body());
        assertEquals(1, countMemberships(ada.workspaceId()));
    }

    @Test
    void changingTheRosterStillRequiresACsrfToken() throws Exception {
        Owner ada = ownerWithWorkspace();
        Person kasia = register("kasia@example.com", "Kasia Nowak");
        ada.browser().postJson(membersPath(ada.workspaceId()), addBody(kasia.email(), "EDITOR"));

        HttpResponse<String> add = ada.browser().sendWithoutCsrf("POST", membersPath(ada.workspaceId()),
                addBody("michal@example.com", "VIEWER"));
        HttpResponse<String> patch = ada.browser().sendWithoutCsrf("PATCH",
                membersPath(ada.workspaceId()) + "/" + kasia.userId(), roleBody("VIEWER"));
        HttpResponse<String> delete = ada.browser().sendWithoutCsrf("DELETE",
                membersPath(ada.workspaceId()) + "/" + kasia.userId(), "");

        for (HttpResponse<String> response : List.of(add, patch, delete)) {
            assertEquals(403, response.statusCode(), response.body());
            assertEquals("FORBIDDEN", ada.browser().json(response).get("code").asString());
        }
        assertEquals(2, countMemberships(ada.workspaceId()));
        assertEquals(List.of("EDITOR"),
                rolesByUserId(ada.browser().get(membersPath(ada.workspaceId())), kasia.userId()));
    }

    /**
     * A role change takes effect on the next request, without the demoted user doing anything.
     *
     * <p>Roles are read from the database per request rather than cached in the session, which is what makes
     * this work — and what makes it safe. A session-cached role would leave a demoted editor with editing
     * rights until they happened to sign out.
     */
    @Test
    void aDemotedEditorLosesEditAccessOnTheirNextRequestButKeepsReading() throws Exception {
        Owner ada = ownerWithWorkspace();
        Person kasia = register("kasia@example.com", "Kasia Nowak");
        ada.browser().postJson(membersPath(ada.workspaceId()), addBody(kasia.email(), "EDITOR"));

        HttpResponse<String> demoted = ada.browser().patchJson(
                membersPath(ada.workspaceId()) + "/" + kasia.userId(), roleBody("VIEWER"));

        assertEquals(200, demoted.statusCode(), demoted.body());
        assertEquals("VIEWER", ada.browser().json(demoted).get("role").asString());

        HttpResponse<String> herRead = kasia.browser().get("/api/workspaces/" + ada.workspaceId());
        assertEquals(200, herRead.statusCode(), "She can still read the workspace");
        assertEquals("VIEWER", kasia.browser().json(herRead).get("role").asString(),
                "and her own view reports the new role immediately, with no new sign-in");
        assertEquals(200, kasia.browser().get(membersPath(ada.workspaceId())).statusCode(),
                "and she can still see the roster");
    }

    @Test
    void settingTheRoleSomebodyAlreadyHasSucceedsWithoutChangingTheRow() throws Exception {
        Owner ada = ownerWithWorkspace();
        Person kasia = register("kasia@example.com", "Kasia Nowak");
        ada.browser().postJson(membersPath(ada.workspaceId()), addBody(kasia.email(), "EDITOR"));
        String createdAtBefore = jdbcTemplate.queryForObject("""
                SELECT created_at::text FROM workspace_members
                WHERE workspace_id = CAST(? AS uuid) AND user_id = CAST(? AS uuid)
                """, String.class, ada.workspaceId(), kasia.userId());

        HttpResponse<String> response = ada.browser().patchJson(
                membersPath(ada.workspaceId()) + "/" + kasia.userId(), roleBody("EDITOR"));

        assertEquals(200, response.statusCode(), response.body());
        assertEquals("EDITOR", ada.browser().json(response).get("role").asString());
        assertEquals(2, countMemberships(ada.workspaceId()), "No second row for the same person");
        assertEquals(createdAtBefore, jdbcTemplate.queryForObject("""
                SELECT created_at::text FROM workspace_members
                WHERE workspace_id = CAST(? AS uuid) AND user_id = CAST(? AS uuid)
                """, String.class, ada.workspaceId(), kasia.userId()),
                "and the existing row was not replaced");
    }

    @Test
    void changingTheRoleOfSomebodyWhoIsNotAMemberIsNotFound() throws Exception {
        Owner ada = ownerWithWorkspace();
        Person outsider = register("outsider@example.com", "Outsider");

        HttpResponse<String> response = ada.browser().patchJson(
                membersPath(ada.workspaceId()) + "/" + outsider.userId(), roleBody("EDITOR"));

        assertEquals(404, response.statusCode(), response.body());
        assertEquals(1, countMemberships(ada.workspaceId()),
                "A role change is not a way to add somebody");
    }

    // --- the last-owner rule ---

    @Test
    void theOnlyOwnerCannotBeDemotedOrRemoved() throws Exception {
        Owner ada = ownerWithWorkspace();
        Person kasia = register("kasia@example.com", "Kasia Nowak");
        ada.browser().postJson(membersPath(ada.workspaceId()), addBody(kasia.email(), "EDITOR"));

        HttpResponse<String> demote = ada.browser().patchJson(
                membersPath(ada.workspaceId()) + "/" + ada.userId(), roleBody("EDITOR"));
        HttpResponse<String> remove = ada.browser().delete(
                membersPath(ada.workspaceId()) + "/" + ada.userId());

        assertEquals(409, demote.statusCode(), demote.body());
        assertEquals("CONFLICT", ada.browser().json(demote).get("code").asString());
        assertTrue(ada.browser().json(demote).get("detail").asString().contains("at least one owner"),
                "The message says what to do about it");
        assertEquals(409, remove.statusCode(), remove.body());

        assertEquals(List.of("OWNER"),
                rolesByUserId(ada.browser().get(membersPath(ada.workspaceId())), ada.userId()),
                "The owner membership stays exactly as it was");
        assertEquals(2, countMemberships(ada.workspaceId()));
    }

    /**
     * Ownership transfer, which is the reason the rule above is a conflict rather than a hard prohibition.
     */
    @Test
    void anOwnerCanStepDownOnceSomebodyElseIsAnOwner() throws Exception {
        Owner ada = ownerWithWorkspace();
        Person kasia = register("kasia@example.com", "Kasia Nowak");
        ada.browser().postJson(membersPath(ada.workspaceId()), addBody(kasia.email(), "EDITOR"));

        HttpResponse<String> promoted = ada.browser().patchJson(
                membersPath(ada.workspaceId()) + "/" + kasia.userId(), roleBody("OWNER"));
        assertEquals(200, promoted.statusCode(), promoted.body());
        assertEquals("OWNER", ada.browser().json(promoted).get("role").asString());
        assertEquals(List.of("OWNER"),
                rolesByUserId(ada.browser().get(membersPath(ada.workspaceId())), ada.userId()),
                "Promoting somebody does not demote the existing owner: the workspace has two");

        HttpResponse<String> steppedDown = ada.browser().patchJson(
                membersPath(ada.workspaceId()) + "/" + ada.userId(), roleBody("EDITOR"));

        assertEquals(200, steppedDown.statusCode(), steppedDown.body());
        assertEquals(List.of("EDITOR"),
                rolesByUserId(ada.browser().get(membersPath(ada.workspaceId())), ada.userId()));
        assertEquals(List.of("OWNER"),
                rolesByUserId(kasia.browser().get(membersPath(ada.workspaceId())), kasia.userId()));

        assertEquals(403, ada.browser().delete(
                        membersPath(ada.workspaceId()) + "/" + kasia.userId()).statusCode(),
                "and the former owner can no longer manage members");
    }

    // --- removal ---

    @Test
    void aRemovedMemberLosesAccessWhileEveryOtherRowSurvives() throws Exception {
        Owner ada = ownerWithWorkspace();
        Person kasia = register("kasia@example.com", "Kasia Nowak");
        ada.browser().postJson(membersPath(ada.workspaceId()), addBody(kasia.email(), "EDITOR"));
        assertEquals(200, kasia.browser().get("/api/workspaces/" + ada.workspaceId()).statusCode());

        HttpResponse<String> removed = ada.browser().delete(
                membersPath(ada.workspaceId()) + "/" + kasia.userId());

        assertEquals(204, removed.statusCode(), removed.body());
        assertTrue(removed.body().isEmpty(), "A removal response says nothing about the person");

        HttpResponse<String> herNextRead = kasia.browser().get("/api/workspaces/" + ada.workspaceId());
        assertEquals(404, herNextRead.statusCode(),
                "Her next request is answered as though the workspace never existed");
        assertEquals("RESOURCE_NOT_FOUND", kasia.browser().json(herNextRead).get("code").asString());
        assertEquals("[]", kasia.browser().get("/api/workspaces").body(),
                "and it is gone from her list");
        assertEquals(404, kasia.browser().get(membersPath(ada.workspaceId())).statusCode(),
                "including the roster she could read a moment ago");

        // Her session is untouched: she is still signed in, just not a member.
        assertEquals(200, kasia.browser().get("/api/me").statusCode(),
                "Losing access to a workspace is not being logged out");

        assertEquals(1, countMemberships(ada.workspaceId()), "Exactly one membership row was deleted");
        assertEquals(1, (int) jdbcTemplate.queryForObject(
                        "SELECT count(*) FROM users WHERE id = CAST(? AS uuid)",
                        Integer.class, kasia.userId()),
                "Her account survives: removing access must not erase who did what");
        assertEquals(1, (int) jdbcTemplate.queryForObject(
                        "SELECT count(*) FROM workspaces WHERE id = CAST(? AS uuid)",
                        Integer.class, ada.workspaceId()),
                "and so does the workspace");
        assertEquals(ada.userId(), jdbcTemplate.queryForObject(
                        "SELECT created_by::text FROM workspaces WHERE id = CAST(? AS uuid)",
                        String.class, ada.workspaceId()),
                "with its authorship column intact");
    }

    @Test
    void removingSomebodyWhoIsNotAMemberIsNotFound() throws Exception {
        Owner ada = ownerWithWorkspace();
        Person outsider = register("outsider@example.com", "Outsider");

        assertEquals(404, ada.browser().delete(
                membersPath(ada.workspaceId()) + "/" + outsider.userId()).statusCode());
        assertEquals(404, ada.browser().delete(
                membersPath(ada.workspaceId()) + "/" + UUID.randomUUID()).statusCode());
        assertEquals(1, countMemberships(ada.workspaceId()));
    }

    // --- archived workspaces ---

    @Test
    void anArchivedWorkspaceAcceptsNoRosterChangesButStillShowsTheRoster() throws Exception {
        Owner ada = ownerWithWorkspace();
        Person kasia = register("kasia@example.com", "Kasia Nowak");
        Person michal = register("michal@example.com", "Michal Kowalski");
        ada.browser().postJson(membersPath(ada.workspaceId()), addBody(kasia.email(), "EDITOR"));
        ada.browser().postJson("/api/workspaces/" + ada.workspaceId() + "/archive", "");

        HttpResponse<String> add = ada.browser().postJson(membersPath(ada.workspaceId()),
                addBody(michal.email(), "VIEWER"));
        HttpResponse<String> patch = ada.browser().patchJson(
                membersPath(ada.workspaceId()) + "/" + kasia.userId(), roleBody("VIEWER"));
        HttpResponse<String> delete = ada.browser().delete(
                membersPath(ada.workspaceId()) + "/" + kasia.userId());

        for (HttpResponse<String> response : List.of(add, patch, delete)) {
            assertEquals(409, response.statusCode(), response.body());
            assertEquals("CONFLICT", ada.browser().json(response).get("code").asString());
        }
        assertEquals(2, countMemberships(ada.workspaceId()), "The roster is frozen, not emptied");
        assertEquals(List.of("EDITOR"),
                rolesByUserId(ada.browser().get(membersPath(ada.workspaceId())), kasia.userId()));

        HttpResponse<String> roster = kasia.browser().get(membersPath(ada.workspaceId()));
        assertEquals(200, roster.statusCode(),
                "Archiving stops changes, not reading: members can still see who was in it");
        assertEquals(2, kasia.browser().json(roster).size());
    }

}
