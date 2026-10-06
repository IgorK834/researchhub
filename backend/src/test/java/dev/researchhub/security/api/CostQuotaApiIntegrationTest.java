package dev.researchhub.security.api;

import dev.researchhub.ai.application.*;
import dev.researchhub.shared.error.ApiErrorCode;
import dev.researchhub.shared.infrastructure.persistence.PostgresTestcontainersConfiguration;
import dev.researchhub.support.ApiBrowser;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.*;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import tools.jackson.databind.ObjectMapper;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = {
        "researchhub.sources.storage.adapter=in-memory", "researchhub.security.quotas.llm.user=2", "researchhub.security.quotas.llm.workspace=3",
        "researchhub.security.quotas.window=PT1H", "researchhub.processing.dispatcher.enabled=false"})
@ActiveProfiles("local")
@Import({PostgresTestcontainersConfiguration.class, CostQuotaApiIntegrationTest.StorageConfiguration.class})
class CostQuotaApiIntegrationTest {
    @org.springframework.boot.test.context.TestConfiguration(proxyBeanMethods=false)
    static class StorageConfiguration {
        @org.springframework.context.annotation.Bean
        dev.researchhub.source.application.SourceStorage sourceStorage() {
            return new dev.researchhub.source.application.InMemorySourceStorage();
        }
    }
    @Value("${local.server.port}") int port;
    @Autowired ObjectMapper json;
    @Autowired JdbcTemplate jdbc;
    @MockitoBean dev.researchhub.ai.infrastructure.HttpModelProvider provider;
    @BeforeEach void setup() {
        jdbc.execute("TRUNCATE users, workspaces CASCADE");
        when(provider.generateStructured(any(ContextContracts.ContextualRequest.class)))
                .thenThrow(new ModelFailure(ApiErrorCode.AI_UNAVAILABLE));
    }
    ApiBrowser browser(String email) throws Exception {
        var browser = new ApiBrowser(port, json); browser.signUp(email, "Researcher"); return browser;
    }
    String ai(String workspace) { return "/api/workspaces/" + workspace + "/ai/generations"; }
    final String command = "{\"instruction\":\"Explain the claim\",\"evidence\":[]}";

    @Test void excessiveRequestsReturnStable429WithoutCallingProviderAndReadsRemainAvailable() throws Exception {
        var user = browser("limited@example.com");
        String workspace = user.createdWorkspaceId("Research", ""), other = user.createdWorkspaceId("Other", "");
        for (int i=0;i<2;i++) assertEquals(503, user.postJson(ai(workspace), command).statusCode());
        var denied = user.postJson(ai(other), command);
        assertEquals(429, denied.statusCode(), denied.body());
        var body = user.json(denied);
        assertEquals("RATE_LIMIT_EXCEEDED", body.get("code").asString());
        assertEquals("LLM", body.get("quotaCategory").asString());
        assertTrue(body.get("retryAfterSeconds").asLong() > 0);
        assertEquals(body.get("retryAfterSeconds").asString(), denied.headers().firstValue("Retry-After").orElseThrow());
        assertEquals("private, no-store", denied.headers().firstValue("Cache-Control").orElseThrow());
        assertEquals(200, user.get("/api/workspaces/"+workspace).statusCode());
        assertEquals(2, jdbc.queryForObject("SELECT count(*) FROM ai_generation_runs", Integer.class));
        verify(provider, times(2)).generateStructured(any(ContextContracts.ContextualRequest.class));
    }
    @Test void workspaceQuotaIsSharedAndUnauthorizedRequestsConsumeNeitherBudget() throws Exception {
        var owner = browser("owner-limit@example.com");
        var member = browser("member-limit@example.com");
        String workspace = owner.createdWorkspaceId("Research", "");
        for (int i=0;i<3;i++) assertEquals(404, member.postJson(ai(workspace), command).statusCode());
        var added = owner.postJson("/api/workspaces/"+workspace+"/members", "{\"email\":\"member-limit@example.com\",\"role\":\"VIEWER\"}");
        assertEquals(201, added.statusCode(), added.body());
        assertEquals(503, owner.postJson(ai(workspace), command).statusCode());
        assertEquals(503, owner.postJson(ai(workspace), command).statusCode());
        assertEquals(503, member.postJson(ai(workspace), command).statusCode());
        assertEquals(429, member.postJson(ai(workspace), command).statusCode());
        verify(provider, times(3)).generateStructured(any(ContextContracts.ContextualRequest.class));
    }
    @Test
    @org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable(named="SECURITY_BROWSER_TESTS", matches="true")
    void productionBrowserShowsUploadRejectionAndQuotaWithoutLosingInput() throws Exception {
        var user = browser("browser-security@example.com");
        UUID userId=jdbc.queryForObject("SELECT id FROM users WHERE email='browser-security@example.com'",UUID.class);
        String workspace=user.createdWorkspaceId("Security review", "Research claims");
        dev.researchhub.source.SourceRowFixture.insertReadyText(jdbc,UUID.randomUUID(),UUID.fromString(workspace),userId,"Ready research material");
        for (int i=0;i<2;i++) assertEquals(503,user.postJson(ai(workspace),command).statusCode());
        var builder=new ProcessBuilder("node","e2e/security.cjs").directory(java.nio.file.Path.of("../frontend").toFile());
        builder.environment().put("E2E_BACKEND_URL","http://127.0.0.1:"+port);
        builder.environment().put("E2E_WORKSPACE_ID",workspace);
        var output=java.nio.file.Path.of("target/security-browser-e2e.log");
        var process=builder.redirectErrorStream(true).redirectOutput(output.toFile()).start();
        if (!process.waitFor(55,java.util.concurrent.TimeUnit.SECONDS)) {
            process.destroyForcibly(); fail("Security browser E2E exceeded its deadline");
        }
        assertEquals(0,process.exitValue(),java.nio.file.Files.readString(output));
        verify(provider,times(2)).generateStructured(any(ContextContracts.ContextualRequest.class));
        assertEquals(2,jdbc.queryForObject("SELECT count(*) FROM ai_generation_runs",Integer.class));
        assertEquals(1,jdbc.queryForObject("SELECT count(*) FROM sources",Integer.class));
        assertEquals(0,jdbc.queryForObject("SELECT count(*) FROM processing_jobs",Integer.class));
    }

}
