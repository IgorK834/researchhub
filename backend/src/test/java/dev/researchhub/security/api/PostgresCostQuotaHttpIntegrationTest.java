package dev.researchhub.security.api;

import dev.researchhub.support.*;
import dev.researchhub.security.infrastructure.PostgresCostQuotaStore;
import java.net.http.HttpResponse;
import java.time.*;
import java.util.UUID;
import org.junit.jupiter.api.*;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import org.springframework.jdbc.core.JdbcTemplate;
import org.testcontainers.junit.jupiter.*;
import org.testcontainers.postgresql.PostgreSQLContainer;
import tools.jackson.databind.ObjectMapper;
import static org.junit.jupiter.api.Assertions.*;

/** Real authentication, CSRF, workspace authorization, MVC admission and ProblemDetail on two servers. */
@Testcontainers
@Timeout(120)
class PostgresCostQuotaHttpIntegrationTest {
    @Container static final PostgreSQLContainer DATABASE = QuotaPostgresFixture.database();
    static ConfigurableApplicationContext applicationA, applicationB;
    static JdbcTemplate jdbc;
    static ObjectMapper json;
    // Invalid business input still consumes an admission, without needing an external model provider.
    private static final String INVALID_COMMAND = "{\"instruction\":\"\",\"evidence\":[]}";

    @TestConfiguration(proxyBeanMethods = false)
    static class FixedTime {
        @Bean @Primary Clock fixedQuotaClock() {
            return Clock.fixed(Instant.parse("2026-10-07T12:00:30Z"), ZoneOffset.UTC);
        }
    }

    @BeforeAll static void start() {
        String[] settings = {"--researchhub.security.quotas.store=postgres",
                "--researchhub.security.quotas.llm.user=2", "--researchhub.security.quotas.llm.workspace=3",
                "--researchhub.security.quotas.cleanup-cron=-"};
        applicationA = SessionTestApplications.startWithConfiguration(DATABASE, "jdbc", FixedTime.class, settings);
        applicationB = SessionTestApplications.startWithConfiguration(DATABASE, "jdbc", FixedTime.class, settings);
        jdbc = applicationA.getBean(JdbcTemplate.class);
        json = applicationA.getBean(ObjectMapper.class);
        assertNotSame(applicationA.getBean(javax.sql.DataSource.class), applicationB.getBean(javax.sql.DataSource.class));
        assertInstanceOf(PostgresCostQuotaStore.class, applicationA.getBean(dev.researchhub.security.application.CostQuotaStore.class));
        assertInstanceOf(PostgresCostQuotaStore.class, applicationB.getBean(dev.researchhub.security.application.CostQuotaStore.class));
    }
    @AfterAll static void stop() {
        if (applicationB != null) applicationB.close();
        if (applicationA != null) applicationA.close();
    }
    @BeforeEach void reset() { jdbc.execute("TRUNCATE cost_quota_bucket, users, workspaces CASCADE"); }

    @RepeatedTest(20) void userQuotaIsSharedBetweenTwoActualHttpServers() throws Exception {
        ApiBrowser userA = browser(applicationA), userB = browser(applicationB);
        String user = userA.signUp("shared-user@example.com", "Researcher");
        assertEquals(200, userB.postJson("/api/auth/login", """
                {"email":"shared-user@example.com","password":"correct-horse-battery-staple"}
                """).statusCode());
        String workspace = userA.createdWorkspaceId("Shared quota", "");
        String path = ai(workspace);
        assertEquals(400, userA.postJson(path, INVALID_COMMAND).statusCode());
        assertEquals(400, userB.postJson(path, INVALID_COMMAND).statusCode());
        var before = jdbc.queryForList("SELECT * FROM cost_quota_bucket ORDER BY scope_type");
        assertQuotaProblem(userA.postJson(path, INVALID_COMMAND));
        assertQuotaProblem(userB.postJson(path, INVALID_COMMAND));
        assertEquals(before, jdbc.queryForList("SELECT * FROM cost_quota_bucket ORDER BY scope_type"));
        assertEquals(2, count("USER", user));
        assertEquals(2, count("WORKSPACE", workspace));
        assertEquals(0, jdbc.queryForObject("SELECT count(*) FROM ai_generation_runs", Integer.class));
        assertEquals(200, userB.get("/api/workspaces/" + workspace).statusCode());
    }

    @RepeatedTest(20) void workspaceRejectionOnBackendBRollsBackTheUserBudget() throws Exception {
        ApiBrowser owner = browser(applicationA), member = browser(applicationB);
        String ownerId = owner.signUp("shared-owner@example.com", "Owner");
        String memberId = member.signUp("shared-member@example.com", "Member");
        String workspace = owner.createdWorkspaceId("Shared workspace", "");
        assertEquals(404, member.postJson(ai(workspace), INVALID_COMMAND).statusCode());
        assertEquals(0, jdbc.queryForObject("SELECT count(*) FROM cost_quota_bucket", Integer.class));
        assertEquals(201, owner.postJson("/api/workspaces/" + workspace + "/members",
                "{\"email\":\"shared-member@example.com\",\"role\":\"VIEWER\"}").statusCode());
        assertEquals(400, owner.postJson(ai(workspace), INVALID_COMMAND).statusCode());
        assertEquals(400, owner.postJson(ai(workspace), INVALID_COMMAND).statusCode());
        assertEquals(400, member.postJson(ai(workspace), INVALID_COMMAND).statusCode());
        assertQuotaProblem(member.postJson(ai(workspace), INVALID_COMMAND));
        assertEquals(2, count("USER", ownerId));
        assertEquals(1, count("USER", memberId));
        assertEquals(3, count("WORKSPACE", workspace));
        String other = member.createdWorkspaceId("Remaining user budget", "");
        assertEquals(400, member.postJson(ai(other), INVALID_COMMAND).statusCode());
        assertQuotaProblem(member.postJson(ai(other), INVALID_COMMAND));
    }

    private static ApiBrowser browser(ConfigurableApplicationContext app) {
        return new ApiBrowser(SessionTestApplications.port(app), json);
    }
    private static String ai(String workspace) { return "/api/workspaces/" + workspace + "/ai/generations"; }
    private static int count(String scope, String id) {
        return jdbc.queryForObject("SELECT request_count FROM cost_quota_bucket WHERE scope_type=? AND scope_id=?",
                Integer.class, scope, UUID.fromString(id));
    }
    private static void assertQuotaProblem(HttpResponse<String> response) {
        assertEquals(429, response.statusCode(), response.body());
        var body = json.readTree(response.body());
        assertTrue(response.headers().firstValue("Content-Type").orElseThrow().startsWith("application/problem+json"));
        assertEquals("RATE_LIMIT_EXCEEDED", body.get("code").asString());
        assertEquals("LLM", body.get("quotaCategory").asString());
        assertEquals(30, body.get("retryAfterSeconds").asLong());
        assertEquals("30", response.headers().firstValue("Retry-After").orElseThrow());
        assertEquals("private, no-store", response.headers().firstValue("Cache-Control").orElseThrow());
    }
}
