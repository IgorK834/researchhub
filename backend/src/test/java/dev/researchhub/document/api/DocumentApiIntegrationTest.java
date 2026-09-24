package dev.researchhub.document.api;

import dev.researchhub.shared.infrastructure.persistence.PostgresTestcontainersConfiguration;
import dev.researchhub.support.ApiBrowser;
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
 * The document endpoints over real HTTP, with a session per person.
 *
 * <p>Three properties are worth this much machinery: a document is reachable only through the workspace that
 * owns it, a viewer cannot write, and a stale save is refused rather than applied. The first two are about what
 * one account can do to another's work, which only separate sessions can express.
 *
 * <p>Not {@code @Transactional}: the server handles these requests on its own threads. Rows are removed before
 * each test.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@ActiveProfiles("local")
@Import(PostgresTestcontainersConfiguration.class)
class DocumentApiIntegrationTest {

    private static final String PARAGRAPH = """
            {"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"%s"}]}]}""";

    @Value("${local.server.port}")
    private int port;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @BeforeEach
    void removeRowsFromPreviousTests() {
        jdbcTemplate.execute("DELETE FROM documents");
        jdbcTemplate.execute("DELETE FROM workspace_members");
        jdbcTemplate.execute("DELETE FROM workspaces");
        jdbcTemplate.execute("DELETE FROM users");
    }

    private ApiBrowser browser() {
        return new ApiBrowser(port, objectMapper);
    }

    /** An owner with a workspace, signed in. */
    private record Owner(ApiBrowser browser, String workspaceId) {
    }

    private Owner ownerWithWorkspace() throws Exception {
        ApiBrowser ada = browser();
        ada.signUp("ada@example.com", "Ada Lovelace");
        return new Owner(ada, ada.createdWorkspaceId("Electronics Lab", "Team 4"));
    }

    /** Adds a second signed-in user to the workspace with the given role. */
    private ApiBrowser memberWithRole(Owner owner, String email, String role) throws Exception {
        ApiBrowser member = browser();
        member.signUp(email, "Team Member");
        HttpResponse<String> added = owner.browser().postJson(
                documentsPath(owner.workspaceId()).replace("/documents", "/members"),
                """
                        {"email": "%s", "role": "%s"}
                        """.formatted(email, role));
        assertEquals(201, added.statusCode(), added.body());
        return member;
    }

    private String documentsPath(String workspaceId) {
        return "/api/workspaces/" + workspaceId + "/documents";
    }

    private String createBody(String title, String text) {
        return """
                {"title": "%s", "content": %s}
                """.formatted(title, PARAGRAPH.formatted(text));
    }

    private String updateBody(String title, String text, long revision) {
        return """
                {"title": "%s", "content": %s, "revision": %d}
                """.formatted(title, PARAGRAPH.formatted(text), revision);
    }

    private String createdDocumentId(Owner owner, String title, String text) throws Exception {
        HttpResponse<String> created = owner.browser().postJson(
                documentsPath(owner.workspaceId()), createBody(title, text));
        assertEquals(201, created.statusCode(), created.body());
        return owner.browser().json(created).get("id").asString();
    }

    private List<String> titlesIn(ApiBrowser browser, HttpResponse<String> listResponse) {
        JsonNode body = browser.json(listResponse);
        List<String> titles = new ArrayList<>();
        for (int index = 0; index < body.size(); index++) {
            titles.add(body.get(index).get("title").asString());
        }
        return titles;
    }

    private int countDocuments() {
        Integer count = jdbcTemplate.queryForObject("SELECT count(*) FROM documents", Integer.class);
        return count == null ? 0 : count;
    }

    // --- creating and reading ---

    @Test
    void createsADocumentAtRevisionOneAndReadsItBack() throws Exception {
        Owner ada = ownerWithWorkspace();

        HttpResponse<String> created = ada.browser().postJson(
                documentsPath(ada.workspaceId()), createBody("Final report", "Measurements"));

        assertEquals(201, created.statusCode(), created.body());
        JsonNode document = ada.browser().json(created);
        assertEquals("Final report", document.get("title").asString());
        assertEquals(1L, document.get("revision").asLong(), "A new document starts at revision 1");
        assertEquals("PROSEMIRROR_JSON", document.get("contentFormat").asString());
        assertTrue(document.get("archivedAt").isNull());

        // The content comes back as a JSON object, not an escaped string a client would have to parse twice.
        assertTrue(document.get("content").isObject());
        assertEquals("doc", document.get("content").get("type").asString());
        assertEquals("Measurements", document.get("content")
                .get("content").get(0).get("content").get(0).get("text").asString());

        HttpResponse<String> reread = ada.browser().get(
                documentsPath(ada.workspaceId()) + "/" + document.get("id").asString());
        assertEquals(200, reread.statusCode(), reread.body());
        assertEquals(document.get("content"), ada.browser().json(reread).get("content"),
                "and the reload returns the same document, which is what persistence means here");
    }

    @Test
    void theListCarriesSummariesWithoutContent() throws Exception {
        Owner ada = ownerWithWorkspace();
        createdDocumentId(ada, "Final report", "Measurements");

        HttpResponse<String> listed = ada.browser().get(documentsPath(ada.workspaceId()));

        assertEquals(200, listed.statusCode(), listed.body());
        JsonNode summary = ada.browser().json(listed).get(0);
        assertEquals("Final report", summary.get("title").asString());
        assertEquals(1L, summary.get("revision").asLong(), "enough to save without a second request");
        assertFalse(summary.has("content"),
                "A list must not grow with the length of the prose inside the workspace");
        assertFalse(listed.body().contains("Measurements"),
                "so the paragraph text is nowhere in the list response");
    }

    @Test
    void theAuthorIsTheCallerEvenWhenTheBodyNamesSomebodyElse() throws Exception {
        Owner ada = ownerWithWorkspace();
        String adaId = jdbcTemplate.queryForObject(
                "SELECT created_by::text FROM workspaces WHERE id = CAST(? AS uuid)",
                String.class, ada.workspaceId());

        HttpResponse<String> created = ada.browser().postJson(documentsPath(ada.workspaceId()), """
                {"title": "Smuggled", "content": %s, "createdBy": "%s", "revision": 99}
                """.formatted(PARAGRAPH.formatted("text"), UUID.randomUUID()));

        assertEquals(201, created.statusCode(), created.body());
        String documentId = ada.browser().json(created).get("id").asString();
        assertEquals(adaId, jdbcTemplate.queryForObject(
                        "SELECT created_by::text FROM documents WHERE id = CAST(? AS uuid)",
                        String.class, documentId),
                "created_by is the session user, never a field from the body");
        assertEquals(1L, ada.browser().json(created).get("revision").asLong(),
                "and a new document starts at 1 whatever the body asked for");
    }

    // --- the acceptance test: a document belongs to one workspace ---

    /**
     * RH-061's acceptance case. The caller is a member of both workspaces, so authorization alone cannot
     * distinguish the requests — only the workspace scoping on the query can.
     */
    @Test
    void aDocumentIsInvisibleThroughAnotherWorkspaceEvenToAMemberOfBoth() throws Exception {
        Owner ada = ownerWithWorkspace();
        String otherWorkspaceId = ada.browser().createdWorkspaceId("Thesis", "Unrelated");
        String documentInFirst = createdDocumentId(ada, "Final report", "Measurements");
        String substitutedPath = documentsPath(otherWorkspaceId) + "/" + documentInFirst;

        HttpResponse<String> read = ada.browser().get(substitutedPath);
        HttpResponse<String> updated = ada.browser().patchJson(substitutedPath,
                updateBody("Hijacked", "Rewritten", 1L));
        HttpResponse<String> archived = ada.browser().delete(substitutedPath);
        HttpResponse<String> nonexistent = ada.browser().get(
                documentsPath(otherWorkspaceId) + "/" + UUID.randomUUID());

        for (HttpResponse<String> response : List.of(read, updated, archived)) {
            assertEquals(404, response.statusCode(), response.body());
            assertEquals("RESOURCE_NOT_FOUND", ada.browser().json(response).get("code").asString());
            assertEquals(ada.browser().json(nonexistent).get("detail").asString(),
                    ada.browser().json(response).get("detail").asString(),
                    "A document reached through the wrong workspace must read exactly like one that "
                            + "does not exist");
        }

        assertEquals(List.of(), titlesIn(ada.browser(), ada.browser().get(documentsPath(otherWorkspaceId))),
                "and the other workspace's list does not contain it");
        assertEquals("Final report", jdbcTemplate.queryForObject(
                        "SELECT title FROM documents WHERE id = CAST(? AS uuid)",
                        String.class, documentInFirst),
                "The substituted update changed nothing");
        assertTrue(jdbcTemplate.queryForObject(
                        "SELECT archived_at IS NULL FROM documents WHERE id = CAST(? AS uuid)",
                        Boolean.class, documentInFirst),
                "and the substituted delete archived nothing");
    }

    @Test
    void aNonMemberGetsTheSameNotFoundAsAMissingDocument() throws Exception {
        Owner ada = ownerWithWorkspace();
        String documentId = createdDocumentId(ada, "Final report", "Measurements");

        ApiBrowser outsider = browser();
        outsider.signUp("outsider@example.com", "Outsider");

        HttpResponse<String> list = outsider.get(documentsPath(ada.workspaceId()));
        HttpResponse<String> read = outsider.get(documentsPath(ada.workspaceId()) + "/" + documentId);
        HttpResponse<String> create = outsider.postJson(documentsPath(ada.workspaceId()),
                createBody("Intruding", "text"));
        HttpResponse<String> update = outsider.patchJson(
                documentsPath(ada.workspaceId()) + "/" + documentId,
                updateBody("Hijacked", "Rewritten", 1L));
        HttpResponse<String> archive = outsider.delete(
                documentsPath(ada.workspaceId()) + "/" + documentId);
        HttpResponse<String> randomWorkspace = outsider.get(documentsPath(UUID.randomUUID().toString()));

        for (HttpResponse<String> response : List.of(list, read, create, update, archive)) {
            assertEquals(404, response.statusCode(), response.body());
            assertEquals("RESOURCE_NOT_FOUND", outsider.json(response).get("code").asString());
            assertEquals(outsider.json(randomWorkspace).get("detail").asString(),
                    outsider.json(response).get("detail").asString(),
                    "Not being a member reads exactly like there being nothing there");
        }
        assertEquals(1, countDocuments());
    }

    // --- roles ---

    @Test
    void aViewerCanReadButNotWrite() throws Exception {
        Owner ada = ownerWithWorkspace();
        String documentId = createdDocumentId(ada, "Final report", "Measurements");
        ApiBrowser viewer = memberWithRole(ada, "viewer@example.com", "VIEWER");

        assertEquals(200, viewer.get(documentsPath(ada.workspaceId())).statusCode());
        HttpResponse<String> read = viewer.get(documentsPath(ada.workspaceId()) + "/" + documentId);
        assertEquals(200, read.statusCode(), read.body());
        assertEquals("Measurements", viewer.json(read).get("content")
                .get("content").get(0).get("content").get(0).get("text").asString());

        HttpResponse<String> create = viewer.postJson(documentsPath(ada.workspaceId()),
                createBody("Mine", "text"));
        HttpResponse<String> update = viewer.patchJson(documentsPath(ada.workspaceId()) + "/" + documentId,
                updateBody("Mine", "Rewritten", 1L));
        HttpResponse<String> archive = viewer.delete(documentsPath(ada.workspaceId()) + "/" + documentId);

        for (HttpResponse<String> response : List.of(create, update, archive)) {
            assertEquals(403, response.statusCode(), response.body());
            assertEquals("FORBIDDEN", viewer.json(response).get("code").asString(),
                    "A viewer is a member, so the workspace is not hidden from them — only closed");
        }
        assertEquals(1, countDocuments());
        assertEquals("Final report", jdbcTemplate.queryForObject(
                "SELECT title FROM documents WHERE id = CAST(? AS uuid)", String.class, documentId));
    }

    @Test
    void anEditorCanCreateUpdateAndArchive() throws Exception {
        Owner ada = ownerWithWorkspace();
        ApiBrowser editor = memberWithRole(ada, "editor@example.com", "EDITOR");

        HttpResponse<String> created = editor.postJson(documentsPath(ada.workspaceId()),
                createBody("Editor's draft", "First pass"));
        assertEquals(201, created.statusCode(), created.body());
        String documentId = editor.json(created).get("id").asString();

        HttpResponse<String> updated = editor.patchJson(
                documentsPath(ada.workspaceId()) + "/" + documentId,
                updateBody("Editor's draft", "Second pass", 1L));
        assertEquals(200, updated.statusCode(), updated.body());
        assertEquals(2L, editor.json(updated).get("revision").asLong());

        assertEquals(204, editor.delete(documentsPath(ada.workspaceId()) + "/" + documentId).statusCode());
    }

    @Test
    void anonymousCallersAreNotLetIn() throws Exception {
        Owner ada = ownerWithWorkspace();
        String documentId = createdDocumentId(ada, "Final report", "Measurements");
        ApiBrowser signedOut = browser();

        assertEquals(401, signedOut.get(documentsPath(ada.workspaceId())).statusCode());
        assertEquals(401, signedOut.get(documentsPath(ada.workspaceId()) + "/" + documentId).statusCode());
        assertEquals(401, signedOut.postJson(documentsPath(ada.workspaceId()),
                createBody("Nope", "text")).statusCode());
        assertEquals(401, signedOut.delete(documentsPath(ada.workspaceId()) + "/" + documentId)
                .statusCode());
        assertEquals(1, countDocuments());
    }

    @Test
    void writingStillRequiresACsrfToken() throws Exception {
        Owner ada = ownerWithWorkspace();
        String documentId = createdDocumentId(ada, "Final report", "Measurements");

        HttpResponse<String> create = ada.browser().sendWithoutCsrf("POST",
                documentsPath(ada.workspaceId()), createBody("Forged", "text"));
        HttpResponse<String> update = ada.browser().sendWithoutCsrf("PATCH",
                documentsPath(ada.workspaceId()) + "/" + documentId,
                updateBody("Forged", "Rewritten", 1L));
        HttpResponse<String> archive = ada.browser().sendWithoutCsrf("DELETE",
                documentsPath(ada.workspaceId()) + "/" + documentId, "");

        for (HttpResponse<String> response : List.of(create, update, archive)) {
            assertEquals(403, response.statusCode(), response.body());
            assertEquals("FORBIDDEN", ada.browser().json(response).get("code").asString());
        }
        assertEquals(1, countDocuments());
        assertEquals("Final report", jdbcTemplate.queryForObject(
                "SELECT title FROM documents WHERE id = CAST(? AS uuid)", String.class, documentId));
    }

    // --- revisions ---

    @Test
    void savingAdvancesTheRevisionEachTime() throws Exception {
        Owner ada = ownerWithWorkspace();
        String documentId = createdDocumentId(ada, "Final report", "First pass");
        String path = documentsPath(ada.workspaceId()) + "/" + documentId;

        HttpResponse<String> second = ada.browser().patchJson(path,
                updateBody("Final report", "Second pass", 1L));
        assertEquals(200, second.statusCode(), second.body());
        assertEquals(2L, ada.browser().json(second).get("revision").asLong());

        HttpResponse<String> third = ada.browser().patchJson(path,
                updateBody("Final report v2", "Third pass", 2L));
        assertEquals(3L, ada.browser().json(third).get("revision").asLong());
        assertEquals("Final report v2", ada.browser().json(third).get("title").asString());
        assertEquals("Third pass", ada.browser().json(third).get("content")
                .get("content").get(0).get("content").get(0).get("text").asString());
    }

    /**
     * Two editors, one document, and the second save loses.
     *
     * <p>The content that would have been overwritten is still there afterwards, which is the property worth
     * having: the alternative is prose disappearing with no record that it existed.
     */
    @Test
    void aStaleSaveIsRefusedAndDoesNotOverwriteTheOtherPerson() throws Exception {
        Owner ada = ownerWithWorkspace();
        String documentId = createdDocumentId(ada, "Final report", "Original");
        ApiBrowser editor = memberWithRole(ada, "editor@example.com", "EDITOR");
        String path = documentsPath(ada.workspaceId()) + "/" + documentId;

        // Both start from revision 1. Ada saves first.
        assertEquals(200, ada.browser().patchJson(path,
                updateBody("Final report", "Ada's paragraph", 1L)).statusCode());

        HttpResponse<String> stale = editor.patchJson(path,
                updateBody("Final report", "The editor's paragraph", 1L));

        assertEquals(409, stale.statusCode(), stale.body());
        assertEquals("CONFLICT", editor.json(stale).get("code").asString());
        String detail = editor.json(stale).get("detail").asString();
        assertTrue(detail.contains("revision 2"), "The detail names the current revision: " + detail);

        HttpResponse<String> current = editor.get(path);
        assertEquals("Ada's paragraph", editor.json(current).get("content")
                        .get("content").get(0).get("content").get(0).get("text").asString(),
                "Ada's text survived the stale save");
        assertEquals(2L, editor.json(current).get("revision").asLong(),
                "and the refused write did not advance the revision");
    }

    @Test
    void aMissingRevisionIsAValidationErrorRatherThanAConflict() throws Exception {
        Owner ada = ownerWithWorkspace();
        String documentId = createdDocumentId(ada, "Final report", "Original");

        HttpResponse<String> response = ada.browser().patchJson(
                documentsPath(ada.workspaceId()) + "/" + documentId, """
                        {"title": "Final report", "content": %s}
                        """.formatted(PARAGRAPH.formatted("No revision sent")));

        assertEquals(400, response.statusCode(), response.body());
        assertEquals("VALIDATION_FAILED", ada.browser().json(response).get("code").asString());
        assertEquals("revision", ada.browser().json(response).get("errors").get(0).get("field").asString(),
                "Forgetting to send it is a different mistake from somebody else having saved first");
        assertEquals(1L, jdbcTemplate.queryForObject(
                "SELECT revision FROM documents WHERE id = CAST(? AS uuid)", Long.class, documentId));
    }

    // --- content validation ---

    @Test
    void refusesContentThatIsNotAJsonObject() throws Exception {
        Owner ada = ownerWithWorkspace();

        for (String notAnObject : List.of("[1,2,3]", "\"<p>markup</p>\"", "42")) {
            HttpResponse<String> response = ada.browser().postJson(documentsPath(ada.workspaceId()), """
                    {"title": "Report", "content": %s}
                    """.formatted(notAnObject));

            assertEquals(400, response.statusCode(), response.body());
            assertEquals("VALIDATION_FAILED", ada.browser().json(response).get("code").asString());
            assertEquals("content",
                    ada.browser().json(response).get("errors").get(0).get("field").asString(),
                    "Reported on the field the client got wrong, for " + notAnObject);
        }
        assertEquals(0, countDocuments());
    }

    @Test
    void refusesABodyThatIsNotJsonAtAll() throws Exception {
        Owner ada = ownerWithWorkspace();

        HttpResponse<String> response = ada.browser().postJson(documentsPath(ada.workspaceId()),
                "this is not json");

        assertEquals(400, response.statusCode(), response.body());
        assertEquals("MALFORMED_REQUEST", ada.browser().json(response).get("code").asString());
        assertEquals(0, countDocuments());
    }

    @Test
    void refusesAnExplicitlyRequestedHtmlFormat() throws Exception {
        Owner ada = ownerWithWorkspace();

        HttpResponse<String> response = ada.browser().postJson(documentsPath(ada.workspaceId()), """
                {"title": "Report", "content": %s, "contentFormat": "HTML"}
                """.formatted(PARAGRAPH.formatted("text")));

        assertEquals(400, response.statusCode(), response.body());
        assertEquals("contentFormat",
                ada.browser().json(response).get("errors").get(0).get("field").asString());
        assertEquals(0, countDocuments());
    }

    @Test
    void refusesContentLargerThanTheDocumentLimit() throws Exception {
        Owner ada = ownerWithWorkspace();
        // One byte past FieldLengths.DOCUMENT_CONTENT_MAX_BYTES. The check is on this field, not on a
        // container-wide upload limit: a body this size is otherwise a normal JSON request.
        String padding = "a".repeat(1_000_000);
        String oversize = "{\"text\":\"" + padding + "\"}";

        HttpResponse<String> response = ada.browser().postJson(documentsPath(ada.workspaceId()), """
                {"title": "Report", "content": %s}
                """.formatted(oversize));

        assertEquals(400, response.statusCode(), response.body());
        assertEquals("VALIDATION_FAILED", ada.browser().json(response).get("code").asString());
        assertEquals("content", ada.browser().json(response).get("errors").get(0).get("field").asString(),
                "Oversize content is a validation failure on the content field");
        assertEquals(0, countDocuments());
    }

    @Test
    void refusesABlankTitle() throws Exception {
        Owner ada = ownerWithWorkspace();

        HttpResponse<String> response = ada.browser().postJson(documentsPath(ada.workspaceId()),
                createBody("   ", "text"));

        assertEquals(400, response.statusCode(), response.body());
        assertEquals("title", ada.browser().json(response).get("errors").get(0).get("field").asString());
        assertEquals(0, countDocuments());
    }

    // --- archiving ---

    @Test
    void archivingHidesTheDocumentFromTheListWithoutDestroyingIt() throws Exception {
        Owner ada = ownerWithWorkspace();
        String keptId = createdDocumentId(ada, "Kept", "Still working on this");
        String archivedId = createdDocumentId(ada, "Retired", "Superseded text");
        String archivedPath = documentsPath(ada.workspaceId()) + "/" + archivedId;

        HttpResponse<String> archived = ada.browser().delete(archivedPath);

        assertEquals(204, archived.statusCode(), archived.body());
        assertTrue(archived.body().isEmpty());
        assertEquals(List.of("Kept"),
                titlesIn(ada.browser(), ada.browser().get(documentsPath(ada.workspaceId()))));

        HttpResponse<String> stillReadable = ada.browser().get(archivedPath);
        assertEquals(200, stillReadable.statusCode(),
                "An archived document stays readable by id: the text is not destroyed");
        assertFalse(ada.browser().json(stillReadable).get("archivedAt").isNull());
        assertEquals("Superseded text", ada.browser().json(stillReadable).get("content")
                .get("content").get(0).get("content").get(0).get("text").asString());

        assertEquals(2, countDocuments(), "Both rows are still there");
        assertFalse(keptId.equals(archivedId));
    }

    @Test
    void archivingTwiceIsANoOp() throws Exception {
        Owner ada = ownerWithWorkspace();
        String documentId = createdDocumentId(ada, "Retired", "text");
        String path = documentsPath(ada.workspaceId()) + "/" + documentId;

        assertEquals(204, ada.browser().delete(path).statusCode());
        String firstArchivedAt = jdbcTemplate.queryForObject(
                "SELECT archived_at::text FROM documents WHERE id = CAST(? AS uuid)",
                String.class, documentId);

        assertEquals(204, ada.browser().delete(path).statusCode(),
                "Archiving something already archived is the state the caller asked for");
        assertEquals(firstArchivedAt, jdbcTemplate.queryForObject(
                        "SELECT archived_at::text FROM documents WHERE id = CAST(? AS uuid)",
                        String.class, documentId),
                "and it does not rewrite when it happened");
        assertEquals(1, countDocuments());
    }

    @Test
    void anArchivedDocumentCannotBeSaved() throws Exception {
        Owner ada = ownerWithWorkspace();
        String documentId = createdDocumentId(ada, "Retired", "text");
        String path = documentsPath(ada.workspaceId()) + "/" + documentId;
        ada.browser().delete(path);

        HttpResponse<String> response = ada.browser().patchJson(path,
                updateBody("Retired", "Reopened", 1L));

        assertEquals(409, response.statusCode(), response.body());
        assertEquals("CONFLICT", ada.browser().json(response).get("code").asString());
        assertEquals(1L, jdbcTemplate.queryForObject(
                "SELECT revision FROM documents WHERE id = CAST(? AS uuid)", Long.class, documentId));
    }

    // --- archived workspaces ---

    @Test
    void anArchivedWorkspaceFreezesItsDocumentsButKeepsThemReadable() throws Exception {
        Owner ada = ownerWithWorkspace();
        String documentId = createdDocumentId(ada, "Final report", "Measurements");
        ada.browser().postJson("/api/workspaces/" + ada.workspaceId() + "/archive", "");
        String path = documentsPath(ada.workspaceId()) + "/" + documentId;

        HttpResponse<String> create = ada.browser().postJson(documentsPath(ada.workspaceId()),
                createBody("Another", "text"));
        HttpResponse<String> update = ada.browser().patchJson(path,
                updateBody("Final report", "Rewritten", 1L));
        HttpResponse<String> archive = ada.browser().delete(path);

        for (HttpResponse<String> response : List.of(create, update, archive)) {
            assertEquals(409, response.statusCode(), response.body());
            assertEquals("CONFLICT", ada.browser().json(response).get("code").asString());
        }
        assertEquals(1, countDocuments(), "Nothing was created");
        assertEquals(1L, jdbcTemplate.queryForObject(
                "SELECT revision FROM documents WHERE id = CAST(? AS uuid)", Long.class, documentId));

        HttpResponse<String> read = ada.browser().get(path);
        assertEquals(200, read.statusCode(),
                "Members keep reading what they wrote: archiving stops changes, not reading");
        assertEquals("Measurements", ada.browser().json(read).get("content")
                .get("content").get(0).get("content").get(0).get("text").asString());
        assertEquals(List.of("Final report"),
                titlesIn(ada.browser(), ada.browser().get(documentsPath(ada.workspaceId()))));
    }

    @Test
    void noDocumentResponseCarriesUserSecrets() throws Exception {
        Owner ada = ownerWithWorkspace();
        HttpResponse<String> created = ada.browser().postJson(
                documentsPath(ada.workspaceId()), createBody("Final report", "Measurements"));
        HttpResponse<String> listed = ada.browser().get(documentsPath(ada.workspaceId()));

        for (String body : new String[]{created.body(), listed.body()}) {
            assertFalse(body.contains("password"));
            assertFalse(body.contains("ada@example.com"),
                    "A document is not a place to expose an address; /api/me is the identity read");
        }
    }

}
