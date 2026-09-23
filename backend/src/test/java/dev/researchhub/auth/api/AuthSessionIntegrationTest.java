package dev.researchhub.auth.api;

import dev.researchhub.shared.infrastructure.persistence.PostgresTestcontainersConfiguration;
import dev.researchhub.user.infrastructure.UserRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.ActiveProfiles;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.net.CookieManager;
import java.net.HttpCookie;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Login and the session it establishes, over real HTTP against a running server.
 *
 * <p>MockMvc cannot prove this. It builds a fresh request object per call with no servlet container
 * behind it, so a returned {@code Set-Cookie} is never resolved back to the same session on the next
 * call. Since the whole point of ADR-001 is that a cookie — and nothing else — carries identity between
 * requests, the test has to speak HTTP and let a cookie jar do its job. That makes the second request
 * here exactly what a browser does after the user presses reload.
 *
 * <p>Not {@code @Transactional}: the server handles these requests on its own threads, so a
 * test-managed transaction would be invisible to them. Rows are removed before each test.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@ActiveProfiles("local")
@Import(PostgresTestcontainersConfiguration.class)
class AuthSessionIntegrationTest {

    private static final String EMAIL = "ada@example.com";
    private static final String PASSWORD = "correct-horse-battery-staple";
    private static final String DISPLAY_NAME = "Ada Lovelace";

    @Value("${local.server.port}")
    private int port;

    @Autowired
    private UserRepository users;

    @Autowired
    private ObjectMapper objectMapper;

    @BeforeEach
    void removeUsersFromPreviousTests() {
        users.deleteAll();
    }

    /**
     * One browser: a cookie jar that keeps whatever the server sets and returns it on later requests,
     * plus the CSRF header the SPA is required to send on mutating calls.
     */
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

        /** POSTs JSON, priming the CSRF cookie first exactly as the frontend client does. */
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

        boolean hasCookie(String name) {
            return cookieValue(name).isPresent();
        }

        HttpResponse<String> register() throws Exception {
            return postJson("/api/auth/register", """
                    {"email": "%s", "password": "%s", "displayName": "%s"}
                    """.formatted(EMAIL, PASSWORD, DISPLAY_NAME));
        }

        HttpResponse<String> login(String email, String password) throws Exception {
            return postJson("/api/auth/login", """
                    {"email": "%s", "password": "%s"}
                    """.formatted(email, password));
        }

        HttpResponse<String> logout() throws Exception {
            return postJson("/api/auth/logout", "");
        }
    }

    private JsonNode json(HttpResponse<String> response) {
        return objectMapper.readTree(response.body());
    }

    @Test
    void logsInAndKeepsTheUserSignedInOnTheNextRequest() throws Exception {
        Browser browser = new Browser();

        HttpResponse<String> registered = browser.register();
        assertEquals(201, registered.statusCode(), registered.body());
        String registeredId = json(registered).get("id").asString();

        HttpResponse<String> loggedIn = browser.login(EMAIL, PASSWORD);
        assertEquals(200, loggedIn.statusCode(), loggedIn.body());
        assertEquals(registeredId, json(loggedIn).get("id").asString());
        assertEquals(EMAIL, json(loggedIn).get("email").asString());
        assertTrue(browser.hasCookie("JSESSIONID"), "Login must establish a session cookie");

        // The refresh: a brand new request carrying only the cookie the browser kept.
        HttpResponse<String> me = browser.get("/api/auth/me");
        assertEquals(200, me.statusCode(), me.body());
        assertEquals(registeredId, json(me).get("id").asString(),
                "The session cookie alone must identify the same user after a reload");
        assertEquals(DISPLAY_NAME, json(me).get("displayName").asString());
    }

    @Test
    void theSessionCookieIsNotReadableByJavaScript() throws Exception {
        Browser browser = new Browser();
        browser.register();
        HttpResponse<String> loggedIn = browser.login(EMAIL, PASSWORD);

        List<String> setCookies = loggedIn.headers().allValues("set-cookie");
        String sessionCookie = setCookies.stream()
                .filter(header -> header.startsWith("JSESSIONID="))
                .findFirst()
                .orElseThrow(() -> new AssertionError("No JSESSIONID in: " + setCookies));

        assertTrue(sessionCookie.toLowerCase().contains("httponly"),
                "ADR-001 requires the session cookie to be HttpOnly, but was: " + sessionCookie);
        assertTrue(sessionCookie.toLowerCase().contains("samesite=lax"),
                "Expected SameSite=Lax, but was: " + sessionCookie);
    }

    @Test
    void aFreshBrowserWithNoSessionIsNotSignedIn() throws Exception {
        HttpResponse<String> me = new Browser().get("/api/auth/me");

        assertEquals(401, me.statusCode());
        assertEquals("UNAUTHENTICATED", json(me).get("code").asString());
    }

    @Test
    void theWrongPasswordIsRejectedAndGrantsNoSession() throws Exception {
        Browser browser = new Browser();
        browser.register();

        HttpResponse<String> attempt = browser.login(EMAIL, "not-the-right-password");

        assertEquals(401, attempt.statusCode());
        assertEquals("UNAUTHENTICATED", json(attempt).get("code").asString());

        HttpResponse<String> me = browser.get("/api/auth/me");
        assertEquals(401, me.statusCode(), "A failed login must not leave an authenticated session");
    }

    @Test
    void anUnknownEmailIsIndistinguishableFromTheWrongPassword() throws Exception {
        Browser browser = new Browser();
        browser.register();

        HttpResponse<String> wrongPassword = browser.login(EMAIL, "not-the-right-password");
        HttpResponse<String> unknownEmail = new Browser().login("nobody@example.com", PASSWORD);

        assertEquals(wrongPassword.statusCode(), unknownEmail.statusCode());
        assertEquals(json(wrongPassword).get("code").asString(),
                json(unknownEmail).get("code").asString());
        assertEquals(json(wrongPassword).get("detail").asString(),
                json(unknownEmail).get("detail").asString(),
                "The two failures must read identically, or the form becomes an account-existence oracle");
        assertEquals("Invalid email or password", json(unknownEmail).get("detail").asString());
    }

    @Test
    void noResponseEverEchoesTheSubmittedPassword() throws Exception {
        Browser browser = new Browser();

        assertFalse(browser.register().body().contains(PASSWORD), "register response");
        assertFalse(browser.login(EMAIL, PASSWORD).body().contains(PASSWORD), "login success response");
        assertFalse(browser.get("/api/auth/me").body().contains(PASSWORD), "current user response");

        HttpResponse<String> failed = new Browser().login(EMAIL, "another-wrong-password");
        assertFalse(failed.body().contains("another-wrong-password"), "failed login response");
    }

    @Test
    void theCanonicalIdentityPathAndItsAliasReturnTheSameUser() throws Exception {
        Browser browser = new Browser();
        browser.register();
        browser.login(EMAIL, PASSWORD);

        HttpResponse<String> canonical = browser.get("/api/me");
        HttpResponse<String> alias = browser.get("/api/auth/me");

        assertEquals(200, canonical.statusCode(), canonical.body());
        assertEquals(200, alias.statusCode(), alias.body());
        assertEquals(canonical.body(), alias.body(),
                "/api/me and /api/auth/me must not drift apart");
    }

    @Test
    void logoutEndsTheSessionSoTheSameCookieNoLongerAuthorizes() throws Exception {
        Browser browser = new Browser();
        browser.register();
        browser.login(EMAIL, PASSWORD);

        assertEquals(200, browser.get("/api/me").statusCode(), "signed in before logout");

        HttpResponse<String> loggedOut = browser.logout();
        assertEquals(204, loggedOut.statusCode(), loggedOut.body());
        assertTrue(loggedOut.body().isEmpty(), "A logout response says nothing about the user");

        // The browser still holds the cookie. It simply no longer resolves to a session, which is the
        // point of keeping session state on the server.
        assertTrue(browser.hasCookie("JSESSIONID"), "The browser still has the cookie it was given");

        HttpResponse<String> afterLogout = browser.get("/api/me");
        assertEquals(401, afterLogout.statusCode(),
                "The invalidated session must not authorize a later request");
        assertEquals("UNAUTHENTICATED", json(afterLogout).get("code").asString());
    }

    @Test
    void logoutAndTheFollowingRejectionNeverEchoThePassword() throws Exception {
        Browser browser = new Browser();
        browser.register();
        browser.login(EMAIL, PASSWORD);

        assertFalse(browser.logout().body().contains(PASSWORD), "logout response");
        assertFalse(browser.get("/api/me").body().contains(PASSWORD), "post-logout 401 response");
    }

    @Test
    void loggingInAgainAfterLogoutWorks() throws Exception {
        Browser browser = new Browser();
        browser.register();
        browser.login(EMAIL, PASSWORD);
        browser.logout();

        HttpResponse<String> secondLogin = browser.login(EMAIL, PASSWORD);

        assertEquals(200, secondLogin.statusCode(), secondLogin.body());
        assertEquals(200, browser.get("/api/me").statusCode(),
                "A new session should work after the previous one was invalidated");
    }

    @Test
    void logoutWithoutASessionIsRejected() throws Exception {
        HttpResponse<String> response = new Browser().logout();

        assertEquals(401, response.statusCode());
        assertEquals("UNAUTHENTICATED", json(response).get("code").asString());
    }

    @Test
    void healthStaysPublicWithNoSession() throws Exception {
        HttpResponse<String> health = new Browser().get("/actuator/health");

        assertEquals(200, health.statusCode());
        assertEquals("UP", json(health).get("status").asString());
    }

    @Test
    void loginRequiresACsrfHeader() throws Exception {
        Browser browser = new Browser();
        browser.register();

        // Same credentials, but no CSRF header: a cross-site form post must not be able to sign anyone in.
        HttpClient bare = HttpClient.newBuilder().cookieHandler(new CookieManager()).build();
        HttpResponse<String> response = bare.send(
                HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/api/auth/login"))
                        .header("Content-Type", "application/json")
                        .POST(HttpRequest.BodyPublishers.ofString(
                                "{\"email\": \"%s\", \"password\": \"%s\"}".formatted(EMAIL, PASSWORD)))
                        .build(),
                HttpResponse.BodyHandlers.ofString());

        assertEquals(403, response.statusCode());
        assertNotNull(json(response).get("code"));
        assertEquals("FORBIDDEN", json(response).get("code").asString());
    }

}
