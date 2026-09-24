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
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Autosave and version history over real HTTP.
 *
 * <p>What is worth proving end to end: an autosave is a save under the same rules but does not flood the history,
 * a manual save always leaves a restore point, the history is readable and never shrinks, a restore moves the
 * document forward rather than rewinding it, and two saves racing on the same revision cannot both win.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@ActiveProfiles("local")
@Import(PostgresTestcontainersConfiguration.class)
class DocumentHistoryApiIntegrationTest {

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
        // TRUNCATE, not DELETE: history rows refuse DELETE (tg_document_versions_immutable).
        jdbcTemplate.execute("TRUNCATE document_versions");
        jdbcTemplate.execute("DELETE FROM documents");
        jdbcTemplate.execute("DELETE FROM workspace_members");
        jdbcTemplate.execute("DELETE FROM workspaces");
        jdbcTemplate.execute("DELETE FROM users");
    }

    private record Owner(ApiBrowser browser, String workspaceId) {
    }

    private Owner ownerWithWorkspace() throws Exception {
        ApiBrowser ada = new ApiBrowser(port, objectMapper);
        ada.signUp("ada@example.com", "Ada Lovelace");
        return new Owner(ada, ada.createdWorkspaceId("Electronics Lab", "Team 4"));
    }

    private ApiBrowser memberWithRole(Owner owner, String email, String role) throws Exception {
        ApiBrowser member = new ApiBrowser(port, objectMapper);
        member.signUp(email, "Team Member");
        HttpResponse<String> added = owner.browser().postJson("/api/workspaces/" + owner.workspaceId() + "/members",
                """
                        {"email": "%s", "role": "%s"}
                        """.formatted(email, role));
        assertEquals(201, added.statusCode(), added.body());
        return member;
    }

    private static String documentsPath(String workspaceId) {
        return "/api/workspaces/" + workspaceId + "/documents";
    }

    private String createdDocumentPath(Owner owner, String text) throws Exception {
        HttpResponse<String> created = owner.browser().postJson(documentsPath(owner.workspaceId()), """
                {"title": "Final report", "content": %s}
                """.formatted(PARAGRAPH.formatted(text)));
        assertEquals(201, created.statusCode(), created.body());
        return documentsPath(owner.workspaceId()) + "/" + owner.browser().json(created).get("id").asString();
    }

    private static String saveBody(String text, long revision, String saveKind) {
        String kind = saveKind == null ? "" : ", \"saveKind\": \"%s\"".formatted(saveKind);
        return """
                {"title": "Final report", "content": %s, "revision": %d%s}
                """.formatted(PARAGRAPH.formatted(text), revision, kind);
    }

    private static String restoreBody(long revision) {
        return """
                {"revision": %d}
                """.formatted(revision);
    }

    private static String textOf(JsonNode document) {
        return document.get("content").get("content").get(0).get("content").get(0).get("text").asString();
    }

    private List<JsonNode> history(ApiBrowser browser, String documentPath) throws Exception {
        HttpResponse<String> response = browser.get(documentPath + "/versions");
        assertEquals(200, response.statusCode(), response.body());
        List<JsonNode> entries = new ArrayList<>();
        browser.json(response).forEach(entries::add);
        return entries;
    }

    private static List<String> reasons(List<JsonNode> history) {
        return history.stream().map(entry -> entry.get("reason").asString()).toList();
    }

    private static List<Long> revisions(List<JsonNode> history) {
        return history.stream().map(entry -> entry.get("revision").asLong()).toList();
    }

    private int countVersions() {
        Integer count = jdbcTemplate.queryForObject("SELECT count(*) FROM document_versions", Integer.class);
        return count == null ? 0 : count;
    }

    // --- recording ---

    @Test
    void creatingADocumentRecordsItsFirstVersion() throws Exception {
        Owner ada = ownerWithWorkspace();
        String path = createdDocumentPath(ada, "Original");

        List<JsonNode> history = history(ada.browser(), path);

        assertEquals(List.of("CREATED"), reasons(history));
        assertEquals(1L, history.get(0).get("revision").asLong());
        assertFalse(history.get(0).has("content"), "The list carries no text");
    }

    @Test
    void aManualSaveAlwaysRecordsAVersion() throws Exception {
        Owner ada = ownerWithWorkspace();
        String path = createdDocumentPath(ada, "Original");

        assertEquals(200, ada.browser().patchJson(path, saveBody("Second", 1L, "MANUAL")).statusCode());
        assertEquals(200, ada.browser().patchJson(path, saveBody("Third", 2L, null)).statusCode(),
                "and a save that does not say is treated as manual");

        List<JsonNode> history = history(ada.browser(), path);
        assertEquals(List.of("MANUAL_SAVE", "MANUAL_SAVE", "CREATED"), reasons(history));
        assertEquals(List.of(3L, 2L, 1L), revisions(history), "Newest first");
    }

    @Test
    void autosavesWithinTheCheckpointIntervalDoNotFloodTheHistory() throws Exception {
        Owner ada = ownerWithWorkspace();
        String path = createdDocumentPath(ada, "Original");

        for (long revision = 1; revision <= 5; revision++) {
            HttpResponse<String> saved = ada.browser().patchJson(path,
                    saveBody("Typing " + revision, revision, "AUTOSAVE"));
            assertEquals(200, saved.statusCode(), saved.body());
            assertEquals(revision + 1, ada.browser().json(saved).get("revision").asLong(),
                    "An autosave is a real save: the revision moves");
        }

        assertEquals(List.of("CREATED"), reasons(history(ada.browser(), path)),
                "Five autosaves a few milliseconds after the first version add no restore points");
        assertEquals("Typing 5", textOf(ada.browser().json(ada.browser().get(path))),
                "and the latest text is what is stored");
    }

    @Test
    void anAutosaveIsStillRevisionChecked() throws Exception {
        Owner ada = ownerWithWorkspace();
        String path = createdDocumentPath(ada, "Original");
        ada.browser().patchJson(path, saveBody("Tab A", 1L, "AUTOSAVE"));

        HttpResponse<String> stale = ada.browser().patchJson(path, saveBody("Tab B", 1L, "AUTOSAVE"));

        assertEquals(409, stale.statusCode(), stale.body());
        assertEquals(2L, ada.browser().json(stale).get("currentRevision").asLong());
        assertEquals("Tab A", textOf(ada.browser().json(ada.browser().get(path))));
    }

    @Test
    void anUnknownSaveKindIsRefusedAndWritesNothing() throws Exception {
        Owner ada = ownerWithWorkspace();
        String path = createdDocumentPath(ada, "Original");

        HttpResponse<String> response = ada.browser().patchJson(path, saveBody("Sneaky", 1L, "SOMETIMES"));

        assertEquals(400, response.statusCode(), response.body());
        assertEquals("MALFORMED_REQUEST", ada.browser().json(response).get("code").asString());
        assertEquals(1L, ada.browser().json(ada.browser().get(path)).get("revision").asLong());
    }

    @Test
    void aRefusedSaveRecordsNoVersion() throws Exception {
        Owner ada = ownerWithWorkspace();
        String path = createdDocumentPath(ada, "Original");
        ada.browser().patchJson(path, saveBody("Second", 1L, "MANUAL"));

        ada.browser().patchJson(path, saveBody("Stale", 1L, "MANUAL"));

        assertEquals(List.of(2L, 1L), revisions(history(ada.browser(), path)));
    }

    // --- reading ---

    @Test
    void oneVersionIsReadWithItsContent() throws Exception {
        Owner ada = ownerWithWorkspace();
        String path = createdDocumentPath(ada, "Original");
        ada.browser().patchJson(path, saveBody("Second", 1L, "MANUAL"));
        String firstId = history(ada.browser(), path).get(1).get("id").asString();

        HttpResponse<String> response = ada.browser().get(path + "/versions/" + firstId);

        assertEquals(200, response.statusCode(), response.body());
        JsonNode version = ada.browser().json(response);
        assertEquals(1L, version.get("revision").asLong());
        assertEquals("CREATED", version.get("reason").asString());
        assertEquals("PROSEMIRROR_JSON", version.get("contentFormat").asString());
        assertTrue(version.get("content").isObject(), "The stored object, not a string of it");
        assertEquals("Original", textOf(version));
    }

    @Test
    void aVersionOfAnotherDocumentIsNotFound() throws Exception {
        Owner ada = ownerWithWorkspace();
        String mine = createdDocumentPath(ada, "Mine");
        String other = createdDocumentPath(ada, "Other");
        String otherVersionId = history(ada.browser(), other).get(0).get("id").asString();

        HttpResponse<String> response = ada.browser().get(mine + "/versions/" + otherVersionId);

        assertEquals(404, response.statusCode(), response.body());
        assertEquals("RESOURCE_NOT_FOUND", ada.browser().json(response).get("code").asString());
        assertEquals(404, ada.browser().postJson(mine + "/versions/" + otherVersionId + "/restore",
                restoreBody(1L)).statusCode(), "and cannot be restored into this one");
    }

    @Test
    void aNonMemberGetsTheSameNotFoundForTheHistoryAsForTheDocument() throws Exception {
        Owner ada = ownerWithWorkspace();
        String path = createdDocumentPath(ada, "Private");
        String versionId = history(ada.browser(), path).get(0).get("id").asString();
        ApiBrowser mallory = new ApiBrowser(port, objectMapper);
        mallory.signUp("mallory@example.com", "Mallory");

        for (HttpResponse<String> response : List.of(
                mallory.get(path + "/versions"),
                mallory.get(path + "/versions/" + versionId),
                mallory.postJson(path + "/versions/" + versionId + "/restore", restoreBody(1L)))) {
            assertEquals(404, response.statusCode(), response.body());
            assertEquals("Document was not found", mallory.json(response).get("detail").asString());
        }
    }

    @Test
    void aViewerCanReadTheHistoryButNotRestore() throws Exception {
        Owner ada = ownerWithWorkspace();
        String path = createdDocumentPath(ada, "Original");
        ada.browser().patchJson(path, saveBody("Second", 1L, "MANUAL"));
        ApiBrowser viewer = memberWithRole(ada, "viewer@example.com", "VIEWER");
        String firstId = history(viewer, path).get(1).get("id").asString();

        assertEquals(200, viewer.get(path + "/versions/" + firstId).statusCode());
        HttpResponse<String> restore = viewer.postJson(path + "/versions/" + firstId + "/restore", restoreBody(2L));

        assertEquals(403, restore.statusCode(), restore.body());
        assertEquals(2L, ada.browser().json(ada.browser().get(path)).get("revision").asLong());
    }

    // --- restoring ---

    @Test
    void restoringCreatesANewRevisionAndKeepsEveryVersion() throws Exception {
        Owner ada = ownerWithWorkspace();
        String path = createdDocumentPath(ada, "Original");
        ada.browser().patchJson(path, saveBody("Second", 1L, "MANUAL"));
        ada.browser().patchJson(path, saveBody("Third", 2L, "MANUAL"));
        String originalId = history(ada.browser(), path).get(2).get("id").asString();
        int versionsBefore = countVersions();

        HttpResponse<String> restored = ada.browser().postJson(path + "/versions/" + originalId + "/restore",
                restoreBody(3L));

        assertEquals(200, restored.statusCode(), restored.body());
        JsonNode document = ada.browser().json(restored);
        assertEquals(4L, document.get("revision").asLong(), "Forward to revision 4, not back to 1");
        assertEquals("Original", textOf(document));
        assertEquals("Final report", document.get("title").asString());
        assertEquals("Original", textOf(ada.browser().json(ada.browser().get(path))), "and that is stored");

        List<JsonNode> history = history(ada.browser(), path);
        assertEquals(List.of("RESTORE", "MANUAL_SAVE", "MANUAL_SAVE", "CREATED"), reasons(history));
        assertEquals(List.of(4L, 3L, 2L, 1L), revisions(history), "Nothing was removed");
        assertEquals(originalId, history.get(0).get("restoredFromVersionId").asString(),
                "The restore records where its text came from");
        assertEquals(versionsBefore + 1, countVersions());
    }

    @Test
    void aStaleRestoreIsRefusedLikeAStaleSave() throws Exception {
        Owner ada = ownerWithWorkspace();
        String path = createdDocumentPath(ada, "Original");
        String originalId = history(ada.browser(), path).get(0).get("id").asString();
        ada.browser().patchJson(path, saveBody("Somebody else's work", 1L, "MANUAL"));

        HttpResponse<String> restore = ada.browser().postJson(path + "/versions/" + originalId + "/restore",
                restoreBody(1L));

        assertEquals(409, restore.statusCode(), restore.body());
        assertEquals("CONFLICT", ada.browser().json(restore).get("code").asString());
        assertEquals(2L, ada.browser().json(restore).get("currentRevision").asLong());
        assertEquals("Somebody else's work", textOf(ada.browser().json(ada.browser().get(path))));
        assertEquals(2, history(ada.browser(), path).size(), "and records nothing");
    }

    @Test
    void anArchivedDocumentKeepsItsHistoryReadableButCannotBeRestored() throws Exception {
        Owner ada = ownerWithWorkspace();
        String path = createdDocumentPath(ada, "Original");
        String originalId = history(ada.browser(), path).get(0).get("id").asString();
        assertEquals(204, ada.browser().delete(path).statusCode());

        HttpResponse<String> restore = ada.browser().postJson(path + "/versions/" + originalId + "/restore",
                restoreBody(1L));

        assertEquals(409, restore.statusCode(), restore.body());
        assertFalse(ada.browser().json(restore).has("currentRevision"));
        assertEquals(List.of("CREATED"), reasons(history(ada.browser(), path)));
    }

    @Test
    void aRestoreWithoutARevisionIsAValidationError() throws Exception {
        Owner ada = ownerWithWorkspace();
        String path = createdDocumentPath(ada, "Original");
        String originalId = history(ada.browser(), path).get(0).get("id").asString();

        HttpResponse<String> restore = ada.browser().postJson(path + "/versions/" + originalId + "/restore", "{}");

        assertEquals(400, restore.statusCode(), restore.body());
        assertEquals("revision", ada.browser().json(restore).get("errors").get(0).get("field").asString());
    }

    // --- racing ---

    /**
     * Two saves carrying the same revision, sent at the same moment. Without the row lock both could read revision
     * N, both pass the comparison, and the second would silently overwrite the first. With it, exactly one wins.
     */
    @Test
    void twoSavesRacingOnTheSameRevisionCannotBothWin() throws Exception {
        Owner ada = ownerWithWorkspace();
        ApiBrowser editor = memberWithRole(ada, "editor@example.com", "EDITOR");
        String path = createdDocumentPath(ada, "Original");

        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            for (long revision = 1; revision <= 5; revision++) {
                CountDownLatch start = new CountDownLatch(1);
                long expected = revision;
                Future<HttpResponse<String>> fromAda = pool.submit(() -> {
                    start.await();
                    return ada.browser().patchJson(path, saveBody("Ada " + expected, expected, "AUTOSAVE"));
                });
                Future<HttpResponse<String>> fromEditor = pool.submit(() -> {
                    start.await();
                    return editor.patchJson(path, saveBody("Editor " + expected, expected, "AUTOSAVE"));
                });
                start.countDown();

                List<Integer> statuses = new ArrayList<>(List.of(
                        fromAda.get().statusCode(), fromEditor.get().statusCode()));
                statuses.sort(null);
                assertEquals(List.of(200, 409), statuses, "Exactly one save of revision " + expected + " wins");
                assertEquals(expected + 1, ada.browser().json(ada.browser().get(path)).get("revision").asLong());
            }
        } finally {
            pool.shutdownNow();
        }
    }

}
