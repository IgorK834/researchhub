package dev.researchhub.source.infrastructure;

import com.sun.net.httpserver.HttpServer;
import dev.researchhub.shared.error.ApiException;
import dev.researchhub.shared.error.ApiErrorCode;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;
import java.net.InetSocketAddress;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.concurrent.atomic.AtomicInteger;
import static org.junit.jupiter.api.Assertions.*;

class BraveExternalSearchProviderTest {
    private HttpServer server;
    private int status;
    private String body, query, credential;
    private AtomicInteger calls = new AtomicInteger();
    private final java.util.List<BraveExternalSearchProvider> clients = new java.util.ArrayList<>();
    @BeforeEach void start() throws Exception {
        status = 200; body = "{\"web\":{\"results\":[]}}";
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/res/v1/web/search", exchange -> {
            calls.incrementAndGet(); query = exchange.getRequestURI().getRawQuery();
            credential = exchange.getRequestHeaders().getFirst("X-Subscription-Token");
            byte[] response = body.getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().set("Content-Type", "application/json");
            exchange.sendResponseHeaders(status, response.length);
            try (var output = exchange.getResponseBody()) { output.write(response); }
        }); server.start();
    }
    @AfterEach void stop() { server.stop(0); clients.forEach(BraveExternalSearchProvider::close); }
    private BraveExternalSearchProvider provider(boolean enabled) {
        var provider = new BraveExternalSearchProvider(JsonMapper.builder().build(), enabled, "private-key", Duration.ofSeconds(2),
                URI.create("http://127.0.0.1:" + server.getAddress().getPort()));
        clients.add(provider); return provider;
    }
    @Test void fixedProviderContractAndInertNormalizedDeduplicatedResults() {
        body = """
          {"web":{"results":[
            {"title":"<b>Solar &amp; heat</b>","url":"https://example.org/a/../paper","description":"<strong>Temperature</strong> effect."},
            {"title":"Duplicate","url":"https://example.org/paper"},
            {"title":"Unsafe","url":"javascript:alert(1)","description":"bad"},
            {"title":"Credentials","url":"https://user:pass@example.org/","description":"bad"},
            {"title":null,"url":"https://example.org/null","description":"bad"},
            {"title":"Other","url":"https://example.org/other"}
          ]}}
          """;
        var p = provider(true); var results = p.search("temperature & efficiency");
        assertTrue(p.available()); assertEquals("BRAVE", p.name()); assertEquals(2, results.size());
        assertEquals("Solar & heat", results.getFirst().title()); assertEquals("Temperature effect.", results.getFirst().snippet());
        assertEquals("https://example.org/paper", results.getFirst().url()); assertEquals("", results.get(1).snippet());
        assertNotNull(results.getFirst().id()); assertTrue(query.contains("q=temperature%20%26%20efficiency"));
        assertTrue(query.contains("count=10")); assertTrue(query.contains("text_decorations=false"));
        assertEquals("private-key", credential);
    }
    @Test void absentWebAndEmptyResultsAreEmptyButMalformedResultsFailSafely() {
        body = "{}"; assertTrue(provider(true).search("solar").isEmpty());
        for (var malformed : new String[]{"[]", "broken", "{\"web\":{}}", "{\"web\":{\"results\":{}}}"}) {
            body = malformed; var failure = assertThrows(ApiException.class, () -> provider(true).search("solar"));
            assertEquals(ApiErrorCode.EXTERNAL_SEARCH_FAILED, failure.code()); assertFalse(failure.getMessage().contains("private-key"));
        }
    }
    @Test void providerErrorsRedirectsAndOversizedResponsesFailWithoutReturningRawBodies() {
        for (int error : new int[]{301, 401, 429, 500}) {
            status = error; body = "secret provider details private-key";
            var failure = assertThrows(ApiException.class, () -> provider(true).search("solar"));
            assertEquals(ApiErrorCode.EXTERNAL_SEARCH_FAILED, failure.code()); assertFalse(failure.getMessage().contains(body));
        }
        status = 200; body = "x".repeat(512 * 1024 + 1);
        assertThrows(ApiException.class, () -> provider(true).search("solar"));
        assertEquals(5, calls.get());
    }
    @Test void disabledProviderAndInvalidConfigurationNeverCallTheNetwork() {
        assertFalse(provider(false).available());
        assertEquals(ApiErrorCode.EXTERNAL_SEARCH_UNAVAILABLE, assertThrows(ApiException.class, () -> provider(false).search("solar")).code());
        assertEquals(0, calls.get());
        for (Duration duration : new Duration[]{Duration.ZERO, Duration.ofSeconds(-1), Duration.ofSeconds(31), null})
            assertThrows(IllegalArgumentException.class, () -> new BraveExternalSearchProvider(JsonMapper.builder().build(), false, "", duration));
        for (String key : new String[]{"", " ", " key", "key\n", null})
            assertThrows(IllegalArgumentException.class, () -> new BraveExternalSearchProvider(JsonMapper.builder().build(), true, key, Duration.ofSeconds(1)));
    }
    @Test void boundsAndUnsafeFieldsAreRejectedWhileOnlyTenSafeResultsAreReturned() {
        String safe = "{\"title\":\"Solar\",\"url\":\"https://example.org/NUMBER\",\"description\":\"OK\"}";
        body = "{\"web\":{\"results\":[" + java.util.stream.IntStream.range(0, 20).mapToObj(i -> safe.replace("NUMBER", "" + i)).collect(java.util.stream.Collectors.joining(",")) + "]}}";
        assertEquals(10, provider(true).search("solar").size());
        body = body.replace("]}}", "," + safe + "]}}");
        assertThrows(ApiException.class, () -> provider(true).search("solar"));
        body = "{\"web\":{\"results\":[" + safe.replace("Solar", "S".repeat(1001)) + "," + safe.replace("OK", "x".repeat(4001)) + "]}}";
        assertTrue(provider(true).search("solar").isEmpty());
    }
}
