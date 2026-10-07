package dev.researchhub.auth.api;

import dev.researchhub.support.SessionBrowser;
import dev.researchhub.support.SessionTestApplications;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestInstance;
import org.opentest4j.AssertionFailedError;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContext;
import org.springframework.security.web.context.HttpSessionSecurityContextRepository;
import org.springframework.session.SessionRepository;
import org.springframework.session.Session;
import org.springframework.session.jdbc.JdbcIndexedSessionRepository;
import org.testcontainers.postgresql.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;
import tools.jackson.databind.ObjectMapper;

import java.io.ByteArrayInputStream;
import java.io.ObjectInputStream;
import java.net.http.HttpResponse;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.HttpCookie;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.UUID;

import static dev.researchhub.support.SessionTestApplications.port;
import static org.awaitility.Awaitility.await;
import static java.time.Duration.ofSeconds;
import static org.junit.jupiter.api.Assertions.*;

/** RH-307/308: real servers, independent contexts, one PostgreSQL, no sticky routing or mocked sessions. */
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class SharedJdbcSessionIntegrationTest {
    private final PostgreSQLContainer database = new PostgreSQLContainer(
            DockerImageName.parse("pgvector/pgvector:0.8.2-pg17-bookworm").asCompatibleSubstituteFor("postgres"));
    private ConfigurableApplicationContext a;
    private ConfigurableApplicationContext b;

    @BeforeAll void startReplicas() {
        database.start();
        a = SessionTestApplications.start(database, "jdbc");
        b = SessionTestApplications.start(database, "jdbc");
        assertNotEquals(port(a), port(b));
        assertNotSame(a.getBean(SessionRepository.class), b.getBean(SessionRepository.class));
        assertInstanceOf(HttpSessionSecurityContextRepository.class,
                a.getBean(org.springframework.security.web.context.SecurityContextRepository.class));
    }

    @AfterAll void stopReplicas() {
        if (a != null) a.close();
        if (b != null) b.close();
        database.close();
    }

    private JdbcTemplate jdbc() { return a.getBean(JdbcTemplate.class); }
    private ObjectMapper json() { return a.getBean(ObjectMapper.class); }
    private String registerAndLogin(SessionBrowser browser) throws Exception {
        String email = UUID.randomUUID() + "@example.test";
        var registered = browser.register(port(a), email);
        assertEquals(201, registered.statusCode(), registered.body());
        String id = json().readTree(registered.body()).get("id").asString();
        var login = browser.login(port(a), email);
        assertEquals(200, login.statusCode(), login.body());
        assertEquals(id, json().readTree(login.body()).get("id").asString());
        String cookie = login.headers().allValues("Set-Cookie").stream()
                .filter(header -> header.startsWith("JSESSIONID=")).findFirst().orElseThrow();
        assertTrue(cookie.toLowerCase().contains("httponly"));
        assertTrue(cookie.toLowerCase().contains("samesite=lax"));
        return id;
    }

    private void assertIdentity(HttpResponse<String> response, String user) {
        assertEquals(200, response.statusCode(), response.body());
        assertEquals(user, json().readTree(response.body()).get("id").asString());
    }

    private int sessions(String user) {
        return jdbc().queryForObject("SELECT count(*) FROM spring_session WHERE principal_name = ?", Integer.class, user);
    }

    @Test void loginOnAIsAcceptedByBAndPersistsOnlyASerializableStringIdentity() throws Exception {
        try (var browser = new SessionBrowser()) {
            String user = registerAndLogin(browser);
            assertIdentity(browser.get(port(b), "/api/me"), user); // RH-308 scenario 1
            assertEquals(1, sessions(user));
            assertEquals(1800, jdbc().queryForObject(
                    "SELECT max_inactive_interval FROM spring_session WHERE principal_name = ?", Integer.class, user));
            byte[] bytes = jdbc().queryForObject("""
                    SELECT attribute_bytes FROM spring_session_attributes a
                    JOIN spring_session s ON s.primary_id = a.session_primary_id
                    WHERE s.principal_name = ? AND a.attribute_name = 'SPRING_SECURITY_CONTEXT'
                    """, byte[].class, user);
            try (var input = new ObjectInputStream(new ByteArrayInputStream(bytes))) {
                var context = assertInstanceOf(SecurityContext.class, input.readObject());
                var authentication = assertInstanceOf(UsernamePasswordAuthenticationToken.class, context.getAuthentication());
                assertInstanceOf(String.class, authentication.getPrincipal());
                assertEquals(user, authentication.getPrincipal());
                assertNull(authentication.getCredentials());
                assertTrue(authentication.getAuthorities().isEmpty());
                assertTrue(authentication.isAuthenticated());
            }
        }
    }

    @Test void logoutOnBDeletesTheRowAndTheCapturedCookieIsAnonymousOnA() throws Exception {
        try (var browser = new SessionBrowser()) {
            String user = registerAndLogin(browser);
            String cookie = "JSESSIONID=" + browser.cookie("JSESSIONID");
            String primary = jdbc().queryForObject("SELECT primary_id FROM spring_session WHERE principal_name = ?", String.class, user);
            var logout = browser.post(port(b), "/api/auth/logout", "", browser.csrf(port(a)));
            assertEquals(204, logout.statusCode(), logout.body()); // RH-308 scenario 2
            assertEquals(0, sessions(user));
            assertEquals(0, jdbc().queryForObject(
                    "SELECT count(*) FROM spring_session_attributes WHERE session_primary_id = ?", Integer.class, primary));
            assertEquals(401, browser.getWithCookie(port(a), "/api/me", cookie).statusCode());
            assertEquals(401, browser.getWithCookie(port(b), "/api/me", cookie).statusCode());
        }
    }

    @Test void aDatabaseDisableIsObservedOnTheVeryNextRequestByEitherReplica() throws Exception {
        try (var browser = new SessionBrowser()) {
            String user = registerAndLogin(browser);
            assertIdentity(browser.get(port(a), "/api/me"), user);
            assertIdentity(browser.get(port(b), "/api/me"), user);
            jdbc().update("UPDATE users SET status = 'DISABLED' WHERE id = ?", UUID.fromString(user));
            assertEquals(401, browser.get(port(b), "/api/me").statusCode()); // RH-308 scenario 3
            assertEquals(401, browser.get(port(a), "/api/me").statusCode());
            assertEquals(1, sessions(user), "Rejection must come from a fresh account lookup, not session expiry");
            jdbc().update("UPDATE users SET status = 'ACTIVE' WHERE id = ?", UUID.fromString(user));
            assertIdentity(browser.get(port(b), "/api/me"), user);
        }
    }

    @Test void theCookieCsrfTokenIssuedByAProtectsAWorkspaceMutationOnB() throws Exception {
        try (var browser = new SessionBrowser()) {
            String user = registerAndLogin(browser);
            String tokenFromA = browser.csrf(port(a));
            String body = "{\"name\":\"Shared sessions\",\"description\":\"CSRF across replicas\"}";
            assertEquals(403, browser.post(port(b), "/api/workspaces", body, null).statusCode());
            assertEquals(403, browser.post(port(b), "/api/workspaces", body, "invalid").statusCode());
            var created = browser.post(port(b), "/api/workspaces", body, tokenFromA); // RH-308 scenario 4
            assertEquals(201, created.statusCode(), created.body());
            var workspace = json().readTree(created.body());
            assertEquals("OWNER", workspace.get("role").asString());
            assertEquals(UUID.fromString(user), jdbc().queryForObject(
                    "SELECT created_by FROM workspaces WHERE id = ?", UUID.class, UUID.fromString(workspace.get("id").asString())));
            assertEquals(0, jdbc().queryForObject(
                    "SELECT count(*) FROM spring_session_attributes WHERE attribute_name LIKE '%CSRF%'", Integer.class),
                    "SecurityConfiguration uses CookieCsrfTokenRepository, not a session CSRF repository");
        }
    }

    @Test void stoppingAKeepsBAuthenticatedAndAFullRestartKeepsTheSameBrowserSignedIn() throws Exception {
        try (var browser = new SessionBrowser()) {
            String user = registerAndLogin(browser);
            String cookie = browser.cookie("JSESSIONID");
            a.close();
            assertEquals(200, browser.get(port(b), "/api/me").statusCode()); // RH-308 scenario 5
            b.close();
            // Both previous contexts (and all servlet sessions) have now been destroyed.
            a = SessionTestApplications.start(database, "jdbc");
            assertIdentity(browser.get(port(a), "/api/me"), user);
            assertEquals(cookie, browser.cookie("JSESSIONID"), "Restart must not require a new login or credential");
            b = SessionTestApplications.start(database, "jdbc");
        }
    }

    @Test
    @SuppressWarnings("unchecked")
    void loginChangesAnExistingJdbcSessionIdAndTheOldIdCannotAuthenticate() throws Exception {
        // JdbcSession is package-private; use the public SessionRepository/Session contract.
        SessionRepository<Session> repository = (SessionRepository<Session>) (SessionRepository<?>)
                a.getBean(JdbcIndexedSessionRepository.class);
        var existing = repository.createSession();
        existing.setAttribute("pre-login-marker", "kept");
        repository.save(existing);
        String oldCookie = Base64.getEncoder().encodeToString(existing.getId().getBytes(StandardCharsets.UTF_8));
        try (var browser = new SessionBrowser()) {
            browser.setSessionCookie(port(a), oldCookie);
            String user = registerAndLogin(browser);
            assertNotEquals(oldCookie, browser.cookie("JSESSIONID"));
            assertNull(repository.findById(existing.getId()));
            assertEquals(401, browser.getWithCookie(port(b), "/api/me", "JSESSIONID=" + oldCookie).statusCode());
            assertIdentity(browser.get(port(b), "/api/me"), user);
            String newId = jdbc().queryForObject("SELECT session_id FROM spring_session WHERE principal_name = ?", String.class, user);
            assertEquals("kept", repository.findById(newId).<String>getAttribute("pre-login-marker"));
        }
    }

    @Test void theScheduledCleanupDeletesExpiredSessionsAndTheirAttributesWithoutAnHttpLookup() throws Exception {
        try (var browser = new SessionBrowser()) {
            String user = registerAndLogin(browser);
            String cookie = "JSESSIONID=" + browser.cookie("JSESSIONID");
            String primary = jdbc().queryForObject("SELECT primary_id FROM spring_session WHERE principal_name = ?", String.class, user);
            jdbc().update("UPDATE spring_session SET expiry_time = ? WHERE principal_name = ?", System.currentTimeMillis() - 1000, user);
            // No findById/HTTP call: only Spring Session's scheduled cleanup can remove the row.
            await().atMost(ofSeconds(10)).pollInterval(ofSeconds(1)).until(() -> sessions(user) == 0);
            assertEquals(0, jdbc().queryForObject(
                    "SELECT count(*) FROM spring_session_attributes WHERE session_primary_id = ?", Integer.class, primary));
            assertEquals(401, browser.getWithCookie(port(b), "/api/me", cookie).statusCode());
        }
    }

    @Test void servletNegativeControlCannotSatisfyTheCrossReplicaAssertion() throws Exception {
        try (var servletA = SessionTestApplications.start(database, "servlet");
             var servletB = SessionTestApplications.start(database, "servlet");
             var browser = new SessionBrowser()) {
            assertTrue(servletA.getBeansOfType(SessionRepository.class).isEmpty());
            assertTrue(servletB.getBeansOfType(SessionRepository.class).isEmpty());
            String email = UUID.randomUUID() + "@example.test";
            assertEquals(201, browser.register(port(servletA), email).statusCode());
            var login = browser.login(port(servletA), email);
            assertEquals(200, login.statusCode(), login.body());
            String user = json().readTree(login.body()).get("id").asString();
            assertIdentity(browser.get(port(servletA), "/api/me"), user);
            var onB = browser.get(port(servletB), "/api/me");
            assertThrows(AssertionFailedError.class, () -> assertIdentity(onB, user));
            assertEquals(401, onB.statusCode(), "The positive proof would fail with replica-local servlet sessions");
            assertEquals(0, sessions(user));
        }
    }

    @Test void jdbcPreservesTheDeployedSecureHttpOnlyAndSameSiteCookiePolicy() throws Exception {
        try (var secure = SessionTestApplications.start(database, "jdbc", "--researchhub.environment=cloud",
                "--researchhub.auth.cors.allowed-origins=", "--server.servlet.session.cookie.secure=true",
                "--server.servlet.session.cookie.same-site=none"); var http = HttpClient.newHttpClient()) {
            String origin = "http://localhost:" + port(secure);
            // HTTP test transport: explicitly replay cookies; a browser sends Secure cookies only over HTTPS.
            var csrf = http.send(HttpRequest.newBuilder(URI.create(origin + "/api/auth/csrf")).GET().build(),
                    HttpResponse.BodyHandlers.ofString());
            String csrfCookie = csrf.headers().allValues("Set-Cookie").stream()
                    .filter(header -> header.startsWith("XSRF-TOKEN=")).findFirst().orElseThrow();
            var parsed = HttpCookie.parse(csrfCookie).getFirst();
            assertTrue(parsed.getSecure());
            assertFalse(parsed.isHttpOnly(), "Only the CSRF cookie must be readable by the SPA");
            String email = UUID.randomUUID() + "@example.test";
            var registration = http.send(HttpRequest.newBuilder(URI.create(origin + "/api/auth/register"))
                    .header("Content-Type", "application/json").header("X-XSRF-TOKEN", parsed.getValue())
                    .header("Cookie", "XSRF-TOKEN=" + parsed.getValue())
                    .POST(HttpRequest.BodyPublishers.ofString("""
                            {"email":"%s","password":"%s","displayName":"Researcher"}
                            """.formatted(email, SessionBrowser.PASSWORD))).build(), HttpResponse.BodyHandlers.ofString());
            assertEquals(201, registration.statusCode(), registration.body());
            var login = http.send(HttpRequest.newBuilder(URI.create(origin + "/api/auth/login"))
                    .header("Content-Type", "application/json").header("X-XSRF-TOKEN", parsed.getValue())
                    .header("Cookie", "XSRF-TOKEN=" + parsed.getValue())
                    .POST(HttpRequest.BodyPublishers.ofString("""
                            {"email":"%s","password":"%s"}
                            """.formatted(email, SessionBrowser.PASSWORD))).build(), HttpResponse.BodyHandlers.ofString());
            assertEquals(200, login.statusCode(), login.body());
            String sessionCookie = login.headers().allValues("Set-Cookie").stream()
                    .filter(header -> header.startsWith("JSESSIONID=")).findFirst().orElseThrow();
            var session = HttpCookie.parse(sessionCookie).getFirst();
            assertTrue(session.isHttpOnly());
            assertTrue(session.getSecure());
            assertTrue(sessionCookie.toLowerCase().contains("samesite=none"));
            var me = http.send(HttpRequest.newBuilder(URI.create(origin + "/api/me"))
                    .header("Cookie", "JSESSIONID=" + session.getValue()).GET().build(), HttpResponse.BodyHandlers.ofString());
            assertEquals(200, me.statusCode(), me.body());
        }
    }
}
