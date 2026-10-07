package dev.researchhub.support;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.net.CookieManager;
import java.net.HttpCookie;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;

/**
 * One browser talking to a running server: a cookie jar that keeps whatever the server sets and returns
 * it on later requests, plus the CSRF header the SPA is required to send on mutating calls.
 *
 * <p>Workspace authorization is about what a <em>particular signed-in user</em> may do, and MockMvc cannot
 * express that — it builds a fresh request per call with no servlet container behind it, so a returned
 * {@code Set-Cookie} is never resolved back to the same session. Two instances of this class are two
 * people at two computers, which is the only way to test isolation honestly.
 *
 * <p>Shared by the HTTP tests of every module rather than copied into each, which is why it lives in a neutral
 * test package instead of next to one of them. {@code AuthSessionIntegrationTest} keeps its own equivalent,
 * because it is testing the cookie mechanics themselves and should not depend on a helper that assumes they
 * work.
 */
public final class ApiBrowser {

    private static final String PASSWORD = "correct-horse-battery-staple";

    private final int port;
    private final ObjectMapper objectMapper;
    private final CookieManager cookies = new CookieManager();
    private final HttpClient http;

    public ApiBrowser(int port, ObjectMapper objectMapper) {
        this.port = port;
        this.objectMapper = objectMapper;
        this.http = HttpClient.newBuilder().cookieHandler(cookies).build();
    }

    public URI url(String path) {
        return URI.create("http://localhost:" + port + path);
    }

    public HttpResponse<String> get(String path) throws Exception {
        return send(HttpRequest.newBuilder(url(path)).GET().build());
    }

    /** Downloads an artifact without decoding binary image bytes as text. */
    public HttpResponse<byte[]> getBytes(String path) throws Exception {
        return http.send(HttpRequest.newBuilder(url(path)).GET().build(), HttpResponse.BodyHandlers.ofByteArray());
    }

    public HttpResponse<String> sendWithMethod(String method, String path, String body) throws Exception {
        return sendWithCsrf(method, path, body);
    }

    /** POSTs JSON, priming the CSRF cookie first exactly as the frontend client does. */
    public HttpResponse<String> postJson(String path, String body) throws Exception {
        return sendWithCsrf("POST", path, body);
    }
    /** Leaves the SSE body live, so tests can assert early events and real disconnect behavior. */
    public HttpResponse<java.io.InputStream> postStream(String path,String body) throws Exception {
        get("/api/auth/csrf");
        return http.send(HttpRequest.newBuilder(url(path)).timeout(java.time.Duration.ofSeconds(15))
            .header("Content-Type","application/json").header("Accept","text/event-stream")
            .header("X-XSRF-TOKEN",cookieValue("XSRF-TOKEN").orElseThrow())
            .POST(HttpRequest.BodyPublishers.ofString(body)).build(),HttpResponse.BodyHandlers.ofInputStream());
    }

    /** POSTs one binary multipart part using the same session and CSRF rules as the browser client. */
    public HttpResponse<String> postFile(String path, String filename, String contentType, byte[] content)
            throws Exception {
        get("/api/auth/csrf");
        String boundary = "researchhub-" + UUID.randomUUID();
        byte[] prefix = ("--" + boundary + "\r\n"
                + "Content-Disposition: form-data; name=\"file\"; filename=\"" + filename + "\"\r\n"
                + "Content-Type: " + contentType + "\r\n\r\n").getBytes(StandardCharsets.UTF_8);
        byte[] suffix = ("\r\n--" + boundary + "--\r\n").getBytes(StandardCharsets.UTF_8);

        return send(HttpRequest.newBuilder(url(path))
                .header("Content-Type", "multipart/form-data; boundary=" + boundary)
                .header("X-XSRF-TOKEN", cookieValue("XSRF-TOKEN").orElseThrow(
                        () -> new IllegalStateException("No XSRF-TOKEN cookie was issued")))
                .POST(HttpRequest.BodyPublishers.ofByteArrays(List.of(prefix, content, suffix)))
                .build());
    }

    /** PATCHes JSON with the CSRF header. The JDK client has no {@code PATCH()} shortcut. */
    public HttpResponse<String> patchJson(String path, String body) throws Exception {
        return sendWithCsrf("PATCH", path, body);
    }

    /**
     * Sends a mutating request with the session cookie but deliberately no CSRF header, which is what a
     * cross-site form post would look like.
     */
    public HttpResponse<String> sendWithoutCsrf(String method, String path, String body) throws Exception {
        return send(HttpRequest.newBuilder(url(path))
                .header("Content-Type", "application/json")
                .method(method, HttpRequest.BodyPublishers.ofString(body))
                .build());
    }

    /** Registers an account, signs in, and returns the new user's id. */
    public String signUp(String email, String displayName) throws Exception {
        HttpResponse<String> registered = postJson("/api/auth/register", """
                {"email": "%s", "password": "%s", "displayName": "%s"}
                """.formatted(email, PASSWORD, displayName));
        assertEquals(201, registered.statusCode(), registered.body());

        HttpResponse<String> loggedIn = postJson("/api/auth/login", """
                {"email": "%s", "password": "%s"}
                """.formatted(email, PASSWORD));
        assertEquals(200, loggedIn.statusCode(), loggedIn.body());

        return json(registered).get("id").asString();
    }

    /** Sends a DELETE with the CSRF header, so a refusal is about the route rather than the token. */
    public HttpResponse<String> delete(String path) throws Exception {
        return sendWithCsrf("DELETE", path, "");
    }

    /** Creates a workspace and returns the response, so a test can assert on the status too. */
    public HttpResponse<String> createWorkspace(String name, String description) throws Exception {
        return postJson("/api/workspaces", """
                {"name": "%s", "description": "%s"}
                """.formatted(name, description));
    }

    /** Creates a workspace, asserts 201, and returns its id. */
    public String createdWorkspaceId(String name, String description) throws Exception {
        HttpResponse<String> created = createWorkspace(name, description);
        assertEquals(201, created.statusCode(), created.body());
        return json(created).get("id").asString();
    }

    public JsonNode json(HttpResponse<String> response) {
        return objectMapper.readTree(response.body());
    }

    public Optional<String> cookieValue(String name) {
        return cookies.getCookieStore().getCookies().stream()
                .filter(cookie -> cookie.getName().equals(name))
                .map(HttpCookie::getValue)
                .findFirst();
    }

    private HttpResponse<String> sendWithCsrf(String method, String path, String body) throws Exception {
        get("/api/auth/csrf");
        return send(HttpRequest.newBuilder(url(path))
                .header("Content-Type", "application/json")
                .header("X-XSRF-TOKEN", cookieValue("XSRF-TOKEN").orElseThrow(
                        () -> new IllegalStateException("No XSRF-TOKEN cookie was issued")))
                .method(method, HttpRequest.BodyPublishers.ofString(body))
                .build());
    }

    private HttpResponse<String> send(HttpRequest request) throws Exception {
        return http.send(request, HttpResponse.BodyHandlers.ofString());
    }

}
