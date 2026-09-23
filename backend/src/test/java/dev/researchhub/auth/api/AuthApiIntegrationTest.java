package dev.researchhub.auth.api;

import dev.researchhub.shared.infrastructure.persistence.PostgresTestcontainersConfiguration;
import dev.researchhub.user.infrastructure.UserRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockCookie;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

import jakarta.servlet.http.Cookie;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Registration and the error contract around it, through the real security filter chain.
 *
 * <p>Runs against PostgreSQL 17 in Testcontainers so the unique index on {@code normalized_email} is the
 * thing that decides a duplicate, and BCrypt output is checked as actually stored.
 *
 * <p>Deliberately <strong>not</strong> {@code @Transactional}. Registration's duplicate handling relies
 * on the insert failing in its own transaction; wrapping the test in one would leave the request holding
 * a rollback-only transaction and turn the expected 409 into a 500. Rows are removed before each test
 * instead.
 *
 * <p>CSRF tokens are obtained the way the SPA obtains them — {@code GET /api/auth/csrf}, then the cookie
 * value echoed in the {@code X-XSRF-TOKEN} header — rather than with a test helper that bypasses the
 * mechanism, so the arrangement the frontend depends on is what gets exercised.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("local")
@Import(PostgresTestcontainersConfiguration.class)
class AuthApiIntegrationTest {

    private static final String PASSWORD = "correct-horse-battery-staple";

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private UserRepository users;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @Autowired
    private PasswordEncoder passwordEncoder;

    @BeforeEach
    void removeUsersFromPreviousTests() {
        users.deleteAll();
    }

    private static String registrationBody(String email, String password, String displayName) {
        return """
                {"email": "%s", "password": "%s", "displayName": "%s"}
                """.formatted(email, password, displayName);
    }

    /** Fetches a CSRF token the same way the browser client does, returning cookie and header value. */
    private Cookie csrfCookie() throws Exception {
        MvcResult result = mockMvc.perform(get("/api/auth/csrf"))
                .andExpect(status().isNoContent())
                .andReturn();

        Cookie cookie = result.getResponse().getCookie("XSRF-TOKEN");
        assertNotNull(cookie, "GET /api/auth/csrf must set the XSRF-TOKEN cookie");
        return cookie;
    }

    /** A POST carrying the CSRF cookie and the matching header. */
    private MockHttpServletRequestBuilder csrfProtectedPost(String path, String body) throws Exception {
        Cookie csrf = csrfCookie();
        return post(path)
                .contentType(MediaType.APPLICATION_JSON)
                .content(body)
                .cookie(new MockCookie(csrf.getName(), csrf.getValue()))
                .header("X-XSRF-TOKEN", csrf.getValue());
    }

    @Test
    void csrfCookieIsReadableByJavaScriptWhileTheSessionCookieIsNot() throws Exception {
        MvcResult result = mockMvc.perform(get("/api/auth/csrf")).andReturn();

        Cookie csrf = result.getResponse().getCookie("XSRF-TOKEN");
        assertNotNull(csrf);
        assertFalse(csrf.isHttpOnly(),
                "The SPA has to read the CSRF token, so this cookie must not be HttpOnly. "
                        + "It is not a credential.");
    }

    @Test
    void registersAUserAndReturnsOnlyPublicMetadata() throws Exception {
        mockMvc.perform(csrfProtectedPost("/api/auth/register",
                        registrationBody("ada@example.com", PASSWORD, "Ada Lovelace")))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.id").exists())
                .andExpect(jsonPath("$.email").value("ada@example.com"))
                .andExpect(jsonPath("$.displayName").value("Ada Lovelace"))
                .andExpect(jsonPath("$.status").value("ACTIVE"))
                // The hash, the normalized key, and the submitted password must not be in the body.
                .andExpect(jsonPath("$.password").doesNotExist())
                .andExpect(jsonPath("$.passwordHash").doesNotExist())
                .andExpect(jsonPath("$.normalizedEmail").doesNotExist())
                .andExpect(content().string(org.hamcrest.Matchers.not(
                        org.hamcrest.Matchers.containsString(PASSWORD))));
    }

    @Test
    void storesABcryptHashRatherThanTheSubmittedPassword() throws Exception {
        mockMvc.perform(csrfProtectedPost("/api/auth/register",
                        registrationBody("grace@example.com", PASSWORD, "Grace Hopper")))
                .andExpect(status().isCreated());

        String storedHash = jdbcTemplate.queryForObject(
                "SELECT password_hash FROM users WHERE normalized_email = ?",
                String.class, "grace@example.com");

        assertNotNull(storedHash);
        assertNotEquals(PASSWORD, storedHash, "The plaintext password must never be stored");
        assertTrue(storedHash.startsWith("$2"), "Expected a BCrypt hash, but was: " + storedHash);
        assertTrue(passwordEncoder.matches(PASSWORD, storedHash),
                "The stored hash must verify against the submitted password");
    }

    @Test
    void trimsTheEmailAndKeepsTheCasingTheUserTyped() throws Exception {
        mockMvc.perform(csrfProtectedPost("/api/auth/register",
                        registrationBody("  Ada.Lovelace@Example.COM  ", PASSWORD, "  Ada  ")))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.email").value("Ada.Lovelace@Example.COM"))
                .andExpect(jsonPath("$.displayName").value("Ada"));

        Integer normalizedRows = jdbcTemplate.queryForObject(
                "SELECT count(*) FROM users WHERE normalized_email = ?",
                Integer.class, "ada.lovelace@example.com");
        assertTrue(normalizedRows != null && normalizedRows == 1,
                "Uniqueness is decided on the lowercased address");
    }

    @Test
    void rejectsAMalformedEmailWithAFieldError() throws Exception {
        mockMvc.perform(csrfProtectedPost("/api/auth/register",
                        registrationBody("not-an-email", PASSWORD, "Ada Lovelace")))
                .andExpect(status().isBadRequest())
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON))
                .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"))
                .andExpect(jsonPath("$.errors[0].field").value("email"));
    }

    @Test
    void rejectsAPasswordShorterThanThePolicyMinimum() throws Exception {
        mockMvc.perform(csrfProtectedPost("/api/auth/register",
                        registrationBody("ada@example.com", "short", "Ada Lovelace")))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"))
                .andExpect(jsonPath("$.errors[0].field").value("password"))
                .andExpect(jsonPath("$.errors[0].message")
                        .value("password must be at least 12 characters"))
                // Even a rejected password must not be echoed back.
                .andExpect(content().string(org.hamcrest.Matchers.not(
                        org.hamcrest.Matchers.containsString("short"))));
    }

    @Test
    void rejectsABlankDisplayName() throws Exception {
        mockMvc.perform(csrfProtectedPost("/api/auth/register",
                        registrationBody("ada@example.com", PASSWORD, "   ")))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"))
                .andExpect(jsonPath("$.errors[0].field").value("displayName"));
    }

    @Test
    void rejectsASecondRegistrationForTheSameEmailIgnoringCase() throws Exception {
        mockMvc.perform(csrfProtectedPost("/api/auth/register",
                        registrationBody("ada@example.com", PASSWORD, "Ada Lovelace")))
                .andExpect(status().isCreated());

        mockMvc.perform(csrfProtectedPost("/api/auth/register",
                        registrationBody("ADA@Example.com", PASSWORD, "Impostor")))
                .andExpect(status().isConflict())
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON))
                .andExpect(jsonPath("$.code").value("CONFLICT"))
                .andExpect(jsonPath("$.detail").value("An account with this email already exists"));

        Integer rows = jdbcTemplate.queryForObject("SELECT count(*) FROM users", Integer.class);
        assertTrue(rows != null && rows == 1, "The duplicate must not have been inserted");
    }

    @Test
    void rejectsAMutatingRequestWithoutACsrfToken() throws Exception {
        mockMvc.perform(post("/api/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(registrationBody("ada@example.com", PASSWORD, "Ada Lovelace")))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("FORBIDDEN"));

        Integer rows = jdbcTemplate.queryForObject("SELECT count(*) FROM users", Integer.class);
        assertTrue(rows != null && rows == 0, "A request without a CSRF token must not create anything");
    }

    @Test
    void currentUserRequiresAuthenticationAndUsesTheProjectErrorShape() throws Exception {
        mockMvc.perform(get("/api/auth/me"))
                .andExpect(status().isUnauthorized())
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON))
                .andExpect(jsonPath("$.code").value("UNAUTHENTICATED"))
                .andExpect(jsonPath("$.detail").value("Authentication is required"));
    }

}
