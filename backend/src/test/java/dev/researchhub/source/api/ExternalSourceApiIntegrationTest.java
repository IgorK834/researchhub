package dev.researchhub.source.api;

import dev.researchhub.source.application.ExternalSearchProvider;
import dev.researchhub.source.application.ExternalSourceService;
import dev.researchhub.shared.error.ApiErrorCode;
import dev.researchhub.shared.error.ApiException;
import dev.researchhub.shared.infrastructure.persistence.PostgresTestcontainersConfiguration;
import dev.researchhub.support.ApiBrowser;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.jdbc.core.JdbcTemplate;
import tools.jackson.databind.ObjectMapper;
import java.util.List;
import java.util.UUID;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@ActiveProfiles("local")
@TestPropertySource(properties = {"researchhub.processing.dispatcher.enabled=false"})
@Import(PostgresTestcontainersConfiguration.class)
class ExternalSourceApiIntegrationTest {
    @Value("${local.server.port}") int port;
    @Autowired ObjectMapper json;
    @Autowired JdbcTemplate jdbc;
    @MockitoBean ExternalSearchProvider provider;
    private ApiBrowser owner, outsider;
    private String workspace, path;
    @BeforeEach void setup() throws Exception {
        jdbc.execute("TRUNCATE users, workspaces CASCADE"); reset(provider);
        when(provider.available()).thenReturn(true); when(provider.name()).thenReturn("BRAVE");
        when(provider.search(anyString())).thenAnswer(call -> List.of(
                ExternalSourceService.validatedResult("Solar & efficiency", "https://example.org/paper", "A web result. Not uploaded evidence."),
                ExternalSourceService.validatedResult("Temperature", "https://example.org/heat", "<script>inert text</script>")));
        owner = new ApiBrowser(port, json); owner.signUp("owner@external.test", "Owner");
        outsider = new ApiBrowser(port, json); outsider.signUp("outsider@external.test", "Outsider");
        workspace = owner.createdWorkspaceId("External lab", null); path = "/api/workspaces/" + workspace + "/external-sources";
    }
    private String discover() throws Exception {
        var response = owner.postJson(path + "/search", "{\"query\":\" solar efficiency \",\"externalSearchEnabled\":true}");
        assertEquals(200, response.statusCode(), response.body()); return response.body();
    }
    private String recordCommand(String discovered, int resultIndex) {
        var search = json.readTree(discovered);
        return "{\"searchId\":\"" + search.get("id").asString() + "\",\"resultId\":\"" + search.get("results").get(resultIndex).get("id").asString() + "\"}";
    }
    @Test void explicitDiscoveryAndIdempotentRecordingKeepFrozenProvenanceAndSeparateIdentity() throws Exception {
        var available = owner.get(path + "/availability"); assertEquals(200, available.statusCode());
        assertTrue(owner.json(available).get("available").asBoolean());
        String discovered = discover(); var search = json.readTree(discovered);
        assertEquals("EXTERNAL_WEB", search.get("evidenceType").asString()); assertEquals("solar efficiency", search.get("query").asString());
        assertEquals(workspace, search.get("workspaceId").asString()); assertEquals(2, search.get("results").size());
        var recorded = owner.postJson(path, recordCommand(discovered, 0)); assertEquals(200, recorded.statusCode(), recorded.body());
        var reference = owner.json(recorded); assertEquals("EXTERNAL_WEB", reference.get("evidenceType").asString());
        assertEquals("BRAVE", reference.get("provider").asString()); assertEquals("solar efficiency", reference.get("query").asString());
        assertEquals(search.get("searchedBy"), reference.get("searchedBy")); assertEquals(search.get("searchedAt"), reference.get("discoveredAt"));
        assertEquals("https://example.org/paper", reference.get("url").asString()); assertEquals(64, reference.get("snapshotSha256").asString().length());
        assertEquals(reference, owner.json(owner.postJson(path, recordCommand(discovered, 0))));
        assertEquals(0, jdbc.queryForObject("SELECT count(*) FROM sources", Integer.class));
        assertEquals(0, jdbc.queryForObject("SELECT count(*) FROM source_retrieval_chunks", Integer.class));
        assertEquals(404, owner.get("/api/workspaces/" + workspace + "/sources/" + reference.get("id").asString()).statusCode());
        // A recorded web UUID cannot enter either the question scope or a source citation contract.
        assertEquals(404, owner.postJson("/api/workspaces/" + workspace + "/ai/questions",
                "{\"question\":\"What does the web paper say?\",\"selectedSourceIds\":[\"" + reference.get("id").asString() + "\"]}").statusCode());
        assertEquals(1, owner.json(owner.get(path)).get("totalElements").asInt());
        assertEquals("private, no-store", recorded.headers().firstValue("Cache-Control").orElseThrow());
        assertThrows(org.springframework.dao.DataAccessException.class, () -> jdbc.update("UPDATE external_source_references SET payload='{}' WHERE workspace_id=?", UUID.fromString(workspace)));
        assertThrows(org.springframework.dao.DataAccessException.class, () -> jdbc.update("DELETE FROM external_source_searches WHERE workspace_id=?", UUID.fromString(workspace)));
    }
    @Test void authorizationCsrfArchivalAndCrossWorkspaceReadsAreEnforcedBeforeProviderCalls() throws Exception {
        String discovered = discover(), command = recordCommand(discovered, 0); owner.postJson(path, command);
        clearInvocations(provider);
        for (String endpoint : List.of(path, path + "/availability")) assertEquals(404, outsider.get(endpoint).statusCode());
        assertEquals(404, outsider.postJson(path + "/search", "{}").statusCode());
        assertEquals(404, outsider.postJson(path, command).statusCode());
        String privateWorkspace = outsider.createdWorkspaceId("Other", null);
        assertEquals(404, outsider.postJson("/api/workspaces/" + privateWorkspace + "/external-sources", command).statusCode());
        assertEquals(0, outsider.json(outsider.get("/api/workspaces/" + privateWorkspace + "/external-sources")).get("totalElements").asInt());
        owner.postJson("/api/workspaces/" + workspace + "/members", "{\"email\":\"outsider@external.test\",\"role\":\"VIEWER\"}");
        assertEquals(200, outsider.get(path).statusCode()); assertEquals(403, outsider.postJson(path + "/search", "{}").statusCode());
        assertEquals(403, outsider.postJson(path, command).statusCode());
        assertEquals(403, owner.sendWithoutCsrf("POST", path + "/search", "{}").statusCode());
        assertEquals(403, owner.sendWithoutCsrf("POST", path, command).statusCode());
        owner.postJson("/api/workspaces/" + workspace + "/archive", "{}");
        assertEquals(409, owner.postJson(path + "/search", "{}").statusCode()); assertEquals(409, owner.postJson(path, command).statusCode());
        assertEquals(200, owner.get(path).statusCode()); verify(provider, never()).search(anyString());
    }
    @Test void optInQueryPaginationAndResultIdentityValidationFailExplicitly() throws Exception {
        for (String invalid : List.of("{}", "{\"query\":\"solar\"}", "{\"query\":\"solar\",\"externalSearchEnabled\":false}",
                "{\"query\":\" \",\"externalSearchEnabled\":true}", json.writeValueAsString(java.util.Map.of("query", "x".repeat(601), "externalSearchEnabled", true)),
                json.writeValueAsString(java.util.Map.of("query", "x ".repeat(76), "externalSearchEnabled", true)),
                json.writeValueAsString(java.util.Map.of("query", "a\nb", "externalSearchEnabled", true))))
            assertEquals(400, owner.postJson(path + "/search", invalid).statusCode(), invalid);
        verify(provider, never()).search(anyString());
        assertEquals(400, owner.postJson(path, "{}").statusCode());
        assertEquals(404, owner.postJson(path, "{\"searchId\":\"" + UUID.randomUUID() + "\",\"resultId\":\"" + UUID.randomUUID() + "\"}").statusCode());
        String discovered = discover(); String command = recordCommand(discovered, 0);
        assertEquals(404, owner.postJson(path, command.replace(json.readTree(discovered).get("results").get(0).get("id").asString(), UUID.randomUUID().toString())).statusCode());
        for (String invalidPage : List.of("page=-1", "page=bad", "page=1000001", "size=0", "size=101")) assertEquals(400, owner.get(path + "?" + invalidPage).statusCode());
        owner.postJson(path, command); owner.postJson(path, recordCommand(discovered, 1));
        var first = owner.json(owner.get(path + "?size=1")); var next = owner.json(owner.get(path + "?size=1&page=1"));
        assertEquals(2, first.get("totalElements").asInt()); assertTrue(first.get("hasNext").asBoolean()); assertFalse(next.get("hasNext").asBoolean());
        assertNotEquals(first.get("items").get(0).get("id"), next.get("items").get(0).get("id"));
    }
    @Test void disabledProviderAndProviderFailuresHaveSafePublicErrorsAndDoNotPersistSearches() throws Exception {
        when(provider.available()).thenReturn(false);
        assertFalse(owner.json(owner.get(path + "/availability")).get("available").asBoolean());
        var disabled = owner.postJson(path + "/search", "{\"query\":\"solar\",\"externalSearchEnabled\":true}");
        assertEquals(503, disabled.statusCode()); assertEquals("EXTERNAL_SEARCH_UNAVAILABLE", owner.json(disabled).get("code").asString());
        when(provider.available()).thenReturn(true); when(provider.search(anyString())).thenThrow(new ApiException(ApiErrorCode.EXTERNAL_SEARCH_FAILED, "External search could not be completed. Try again later"));
        var failed = owner.postJson(path + "/search", "{\"query\":\"solar\",\"externalSearchEnabled\":true}");
        assertEquals(502, failed.statusCode()); assertEquals("EXTERNAL_SEARCH_FAILED", owner.json(failed).get("code").asString());
        assertEquals(0, jdbc.queryForObject("SELECT count(*) FROM external_source_searches", Integer.class));
    }
    @Test void revokedMembershipDuringProviderCallCannotPublishOrRecordResults() throws Exception {
        when(provider.search(anyString())).thenAnswer(call -> {
            jdbc.update("DELETE FROM workspace_members WHERE workspace_id=?", UUID.fromString(workspace));
            return List.of(ExternalSourceService.validatedResult("Revoked", "https://example.org/revoked", "Private query result"));
        });
        var response = owner.postJson(path + "/search", "{\"query\":\"solar\",\"externalSearchEnabled\":true}");
        assertEquals(404, response.statusCode()); assertFalse(response.body().contains("Private query result"));
        assertEquals(0, jdbc.queryForObject("SELECT count(*) FROM external_source_searches", Integer.class));
    }
}
