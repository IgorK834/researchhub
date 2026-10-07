package dev.researchhub.support;

import java.net.CookieManager;
import java.net.HttpCookie;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.io.IOException;
import java.util.Map;
import java.util.List;

/** One browser can explicitly route each request to a different replica, without fetching a new token. */
public final class SessionBrowser implements AutoCloseable {
    public static final String PASSWORD = "correct-horse-battery-staple";
    private final CookieManager cookies = new CookieManager();
    private final HttpClient http = HttpClient.newBuilder().cookieHandler(cookies)
            .connectTimeout(Duration.ofSeconds(5)).build();

    private static URI url(int port, String path) { return URI.create("http://localhost:" + port + path); }

    public HttpResponse<String> get(int port, String path) throws Exception {
        return send(HttpRequest.newBuilder(url(port, path)).GET());
    }

    public HttpResponse<String> getWithCookie(int port, String path, String cookie) throws Exception {
        // A separate client replays a captured credential even after the browser received an expiry cookie.
        try (var replay = HttpClient.newHttpClient()) {
            return replay.send(HttpRequest.newBuilder(url(port, path)).timeout(Duration.ofSeconds(15))
                    .header("Cookie", cookie).GET().build(), HttpResponse.BodyHandlers.ofString());
        }
    }

    public HttpResponse<String> post(int port, String path, String body, String csrf) throws Exception {
        var request = HttpRequest.newBuilder(url(port, path)).header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(body));
        if (csrf != null) request.header("X-XSRF-TOKEN", csrf);
        return send(request);
    }

    public String csrf(int port) throws Exception {
        var response = get(port, "/api/auth/csrf");
        if (response.statusCode() != 204) throw new AssertionError("CSRF endpoint: " + response.statusCode() + " " + response.body());
        return cookie("XSRF-TOKEN");
    }

    public HttpResponse<String> register(int port, String email) throws Exception {
        return post(port, "/api/auth/register", """
                {"email":"%s","password":"%s","displayName":"Researcher"}
                """.formatted(email, PASSWORD), csrf(port));
    }

    public HttpResponse<String> login(int port, String email) throws Exception {
        return post(port, "/api/auth/login", """
                {"email":"%s","password":"%s"}
                """.formatted(email, PASSWORD), csrf(port));
    }

    public String cookie(String name) {
        return cookies.getCookieStore().getCookies().stream().filter(cookie -> cookie.getName().equals(name))
                .map(HttpCookie::getValue).findFirst().orElseThrow(() -> new AssertionError("Missing cookie " + name));
    }

    public void setSessionCookie(int port, String value) throws IOException {
        // Let CookieManager apply exactly the same host/path rules as a real Set-Cookie response.
        cookies.put(url(port, "/"), Map.of("Set-Cookie", List.of("JSESSIONID=" + value + "; Path=/; HttpOnly; SameSite=Lax")));
    }

    private HttpResponse<String> send(HttpRequest.Builder request) throws Exception {
        return http.send(request.timeout(Duration.ofSeconds(15)).build(), HttpResponse.BodyHandlers.ofString());
    }

    @Override public void close() { http.close(); }
}
