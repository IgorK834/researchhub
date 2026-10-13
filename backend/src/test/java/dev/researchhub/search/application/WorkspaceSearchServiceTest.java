package dev.researchhub.search.application;

import dev.researchhub.search.application.WorkspaceSearchContracts.Type;
import dev.researchhub.search.application.WorkspaceSearchContracts.Cursor;
import dev.researchhub.shared.error.ApiException;
import dev.researchhub.workspace.application.WorkspaceAuthorizationService;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;

class WorkspaceSearchServiceTest {
    private final FakeStore store = new FakeStore();
    private final RecordingAuthorization authorization = new RecordingAuthorization();
    private final WorkspaceSearchService service = new WorkspaceSearchService(store, authorization);
    private final UUID workspace = UUID.randomUUID();
    private final UUID user = UUID.randomUUID();

    @Test
    void returnsPlainSnippetsAllTypesAndQueryBoundCursorWithoutModelCalls() {
        var hits = java.util.Arrays.stream(Type.values()).map(type -> new WorkspaceSearchStore.Hit(type,
                UUID.randomUUID(), type + " title", "prefix <script>alert(1)</script> target suffix",
                "/" + type, type == Type.SOURCE ? "v1" : null, Instant.parse("2026-10-13T10:00:00Z")))
                .toList();
        store.response = hits;

        var page = service.search(workspace, user, " target ", "", null, 4);

        assertEquals(4, page.items().size());
        assertNotNull(page.nextCursor());
        assertTrue(page.items().getFirst().snippet().contains("<script>"));
        assertEquals(1, authorization.reads);
        assertThrows(ApiException.class,
                () -> service.search(workspace, user, "different", "", page.nextCursor(), 4));
    }

    @Test
    void validatesBoundsTypesAndCursor() {
        assertThrows(ApiException.class, () -> service.search(workspace, user, "", "", null, 20));
        assertThrows(ApiException.class, () -> service.search(workspace, user, "x", "OTHER", null, 20));
        assertThrows(ApiException.class, () -> service.search(workspace, user, "x", "", "broken", 20));
        assertThrows(ApiException.class, () -> service.search(workspace, user, "x", "", null, 51));
        assertThrows(ApiException.class, () -> service.search(workspace, user, "x\ny", "", null, 20));
        assertThrows(ApiException.class, () -> service.search(workspace, user, null, null, null, 0));
        assertThrows(ApiException.class, () -> service.search(workspace, user, "x".repeat(201), "", null, 20));
        assertThrows(ApiException.class, () -> service.search(workspace, user, "x", "", "a".repeat(513), 20));
        store.response=List.of();assertNull(service.search(workspace,user,"x",null," ",20).nextCursor());
    }

    @Test void createsBoundedContextualPlainTextSnippetsForLongAndEmptyInputs() {
        assertEquals("",WorkspaceSearchService.snippet(null,"query"));
        assertEquals("",WorkspaceSearchService.snippet("   ","query"));
        assertEquals("unrelated text",WorkspaceSearchService.snippet("unrelated text","query"));
        assertEquals("single letter",WorkspaceSearchService.snippet("single letter","a"));
        String body="prefix words ".repeat(30)+"needle " +"trailing words ".repeat(30);
        String snippet=WorkspaceSearchService.snippet(body,"a absent needle");
        assertTrue(snippet.startsWith("…"));assertTrue(snippet.endsWith("…"));assertTrue(snippet.contains("needle"));
        assertTrue(snippet.length()<=302);
    }

    @Test
    void paginationPassesDecodedTupleAndSelectedTypes() {
        var first = new WorkspaceSearchStore.Hit(Type.DOCUMENT, UUID.randomUUID(), "Title", "needle", "/d",
                "7", Instant.parse("2026-10-13T10:00:00Z"));
        var extra = new WorkspaceSearchStore.Hit(Type.SOURCE, UUID.randomUUID(), "Source", "needle", "/s",
                "v", Instant.parse("2026-10-12T10:00:00Z"));
        store.response = List.of(first, extra);
        var page = service.search(workspace, user, "needle", "SOURCE,DOCUMENT", null, 1);
        assertNotNull(page.nextCursor());
        store.response = List.of(extra);
        var next = service.search(workspace, user, "needle", "DOCUMENT,SOURCE", page.nextCursor(), 1);
        assertEquals(Type.SOURCE, next.items().getFirst().type());
        assertNull(next.nextCursor());
        assertNotNull(store.cursor);
        assertEquals(Set.of(Type.DOCUMENT, Type.SOURCE), store.types);
    }

    private static final class FakeStore implements WorkspaceSearchStore {
        List<Hit> response = List.of();
        Cursor cursor;
        Set<Type> types;
        @Override public List<Hit> search(UUID workspaceId, UUID callerId, String query, Set<Type> types, Cursor cursor, int fetchLimit) {
            this.cursor = cursor;
            this.types = types;
            return response;
        }
    }

    private static final class RecordingAuthorization extends WorkspaceAuthorizationService {
        int reads;
        RecordingAuthorization() { super(null, null); }
        @Override public void requireContentReader(UUID workspaceId, UUID userId) { reads++; }
    }
}
