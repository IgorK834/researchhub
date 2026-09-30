package dev.researchhub.ai.infrastructure;

import com.sun.net.httpserver.HttpServer;
import dev.researchhub.ai.application.*;
import dev.researchhub.ai.application.GenerationContracts.*;
import dev.researchhub.shared.error.ApiErrorCode;
import org.junit.jupiter.api.*;
import tools.jackson.databind.ObjectMapper;
import java.net.*;
import java.nio.file.*;
import java.time.Duration;
import java.util.concurrent.atomic.AtomicInteger;
import static org.junit.jupiter.api.Assertions.*;

class HttpModelProviderTest {
    private HttpServer server;
    private final ObjectMapper json = new ObjectMapper();
    private final AtomicInteger calls = new AtomicInteger();
    private String body;
    private int status;
    private HttpModelProvider provider;
    private Request request;
    private URI url;
    private static final String TOKEN = "generation-http-test-token-at-least-32-characters";
    @BeforeEach void prepare() throws Exception {
        request = json.readValue(Files.readString(Path.of("../contracts/ai/v1/generation-request.json")), Request.class);
        body = Files.readString(Path.of("../contracts/ai/v1/generation-result.json")); status = 200;
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/internal/ai", exchange -> {
            calls.incrementAndGet();
            assertEquals("Bearer " + TOKEN, exchange.getRequestHeaders().getFirst("Authorization"));
            if (exchange.getRequestMethod().equals("POST"))
                assertEquals(json.valueToTree(request), json.readTree(exchange.getRequestBody().readAllBytes()));
            byte[] data = body.getBytes(java.nio.charset.StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(status, data.length); exchange.getResponseBody().write(data); exchange.close();
        }); server.start();
        url = URI.create("http://127.0.0.1:" + server.getAddress().getPort());
        provider = new HttpModelProvider(json, url, TOKEN, Duration.ofSeconds(2));
    }
    @AfterEach void stop() { server.stop(0); }
    @Test void sendsTheExplicitContractAndReturnsUsageAndModelMetadata() {
        var result = provider.generateStructured(request);
        assertEquals(request.requestId(), result.requestId()); assertTrue(result.usage().estimated());
        body = json.writeValueAsString(result.model());
        assertEquals(result.model(), provider.modelMetadata()); assertEquals(2, calls.get());
    }
    @Test void rejectsUnboundedUnknownAndCoercedResponses() throws Exception {
        String fixture = body;
        for (String invalid : new String[]{"null", "{}", "not-json", "x".repeat(256 * 1024 + 1),
            fixture.replace("\"estimated\": true", "\"estimated\": \"true\""),
            fixture.replace(",\n    \"estimated\": true", ""),
            fixture.replace("\"schemaVersion\": \"1.0\"", "\"schemaVersion\": \"1.0\", \"tool\": \"readDb\"")}) {
            body = invalid;
            assertEquals(ApiErrorCode.AI_OUTPUT_INVALID, assertThrows(ModelFailure.class, () -> provider.generateStructured(request)).code());
        }
        body = fixture.replace(request.requestId().toString(), "20000000-0000-0000-0000-000000000001");
        assertEquals(ApiErrorCode.AI_OUTPUT_INVALID, assertThrows(ModelFailure.class, () -> provider.generateStructured(request)).code());
        body = fixture.replace("a".repeat(64), "b".repeat(64));
        assertEquals(ApiErrorCode.AI_OUTPUT_INVALID, assertThrows(ModelFailure.class, () -> provider.generateStructured(request)).code());
    }
    @Test void mapsOnlySafeErrorCodesAndDoesNotRetryGenerationAtTheHttpBoundary() {
        for (int httpStatus : new int[]{400, 401, 422, 429, 502, 503, 504}) {
            status = httpStatus; body = "private prompt and API key";
            var failure = assertThrows(ModelFailure.class, () -> provider.generateStructured(request));
            var expected = httpStatus == 422 ? ApiErrorCode.AI_REFUSED : httpStatus == 429 || httpStatus == 503 || httpStatus == 504
                ? ApiErrorCode.AI_UNAVAILABLE : ApiErrorCode.AI_PROVIDER_ERROR;
            assertEquals(expected, failure.code()); assertNull(failure.getCause()); assertFalse(failure.getMessage().contains("private"));
        }
        assertEquals(7, calls.get());
        status = 502; body = "{\"code\":\"AI_OUTPUT_INVALID\",\"detail\":\"private\"}";
        assertEquals(ApiErrorCode.AI_OUTPUT_INVALID, assertThrows(ModelFailure.class, () -> provider.generateStructured(request)).code());
        body = "{\"code\":\"INTERNAL_ERROR\"}";
        assertEquals(ApiErrorCode.AI_PROVIDER_ERROR, assertThrows(ModelFailure.class, () -> provider.generateStructured(request)).code());
        body = "x".repeat(1025);
        assertEquals(ApiErrorCode.AI_PROVIDER_ERROR, assertThrows(ModelFailure.class, () -> provider.generateStructured(request)).code());
    }
    @Test void networkFailuresHaveNoUnsafeCause() {
        server.stop(0);
        var failure = assertThrows(ModelFailure.class, () -> provider.modelMetadata());
        assertEquals(ApiErrorCode.AI_UNAVAILABLE, failure.code()); assertNull(failure.getCause());
    }
    @Test void validatesWorkerConnectionBeforeSendingCredentials() {
        for (URI invalid : new URI[]{URI.create("file:/private"), URI.create("http://user:secret@example.com"), URI.create("https://example.com?token=secret"), URI.create("https://example.com#x")})
            assertThrows(IllegalArgumentException.class, () -> new HttpModelProvider(json, invalid, TOKEN, Duration.ofSeconds(1)));
        assertThrows(IllegalArgumentException.class, () -> new HttpModelProvider(json, url, "short", Duration.ofSeconds(1)));
        assertThrows(IllegalArgumentException.class, () -> new HttpModelProvider(json, url, TOKEN, Duration.ZERO));
        assertThrows(IllegalArgumentException.class, () -> new HttpModelProvider(json, null, TOKEN, Duration.ofSeconds(1)));
    }
}
