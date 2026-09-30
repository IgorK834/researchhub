package dev.researchhub.ai.infrastructure;

import com.sun.net.httpserver.HttpServer;
import dev.researchhub.ai.application.*;
import dev.researchhub.processing.infrastructure.ProcessingProperties;
import org.junit.jupiter.api.*;
import tools.jackson.databind.ObjectMapper;
import java.net.*;
import java.util.*;
import java.util.concurrent.atomic.AtomicInteger;
import static org.junit.jupiter.api.Assertions.*;

class HttpEmbeddingProviderTest {
    private HttpServer server;
    private final ObjectMapper mapper = new ObjectMapper();
    private final EmbeddingModel model = new EmbeddingModel("test","model","1",2);
    private final AtomicInteger requests = new AtomicInteger();
    private int status = 200;
    private String response;
    private HttpEmbeddingProvider provider;
    @BeforeEach void setup() throws Exception {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
        server.createContext("/internal/embeddings",exchange -> {
            assertEquals("Bearer embedding-test-token-at-least-32-characters",exchange.getRequestHeaders().getFirst("Authorization"));
            requests.incrementAndGet();
            String body;
            if (response != null) body = response;
            else if (exchange.getRequestURI().getPath().endsWith("model")) body = mapper.writeValueAsString(model);
            else {
                var texts = mapper.readTree(exchange.getRequestBody().readAllBytes()).get("texts");
                body = mapper.writeValueAsString(new EmbeddingBatch(model,Collections.nCopies(texts.size(),List.of(1.0,0.0))));
            }
            byte[] bytes = body.getBytes(java.nio.charset.StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(status,bytes.length); exchange.getResponseBody().write(bytes); exchange.close();
        }); server.start();
        var properties = new ProcessingProperties();
        properties.getWorker().setBaseUrl(URI.create("http://127.0.0.1:" + server.getAddress().getPort()));
        properties.getWorker().setServiceToken("embedding-test-token-at-least-32-characters");
        provider = new HttpEmbeddingProvider(mapper,properties.getWorker().getBaseUrl(),properties.getWorker().getServiceToken(),properties.getWorker().getRequestTimeout());
    }
    @AfterEach void stop() { server.stop(0); }
    @Test void batchesAndFetchesMetadataWithoutVendorCoupling() {
        assertEquals(65,provider.embedDocuments(Collections.nCopies(65,"text")).vectors().size());
        assertEquals(3,requests.get());
        assertEquals(model,provider.modelMetadata());
        assertEquals(1,provider.embedQuery("query").vectors().size());
        assertEquals(model,provider.embedDocuments(List.of()).metadata());
    }
    @Test void rejectsInvalidRequestsAndMalformedProviderResponses() {
        assertThrows(IllegalArgumentException.class,() -> provider.embedDocuments(null));
        assertThrows(IllegalArgumentException.class,() -> provider.embedDocuments(Collections.nCopies(10001,"x")));
        assertThrows(IllegalArgumentException.class,() -> provider.embedDocuments(Collections.singletonList(null)));
        assertThrows(IllegalArgumentException.class,() -> provider.embedDocuments(List.of(" ")));
        assertThrows(IllegalArgumentException.class,() -> provider.embedDocuments(List.of("x".repeat(8001))));
        response = mapper.writeValueAsString(new EmbeddingBatch(model,List.of()));
        assertFalse(assertThrows(EmbeddingFailure.class,() -> provider.embedQuery("q")).retryable());
        response = "x".repeat(4 * 1024 * 1024 + 1);
        assertFalse(assertThrows(EmbeddingFailure.class,() -> provider.embedQuery("q")).retryable());
        response = "{}";
        assertThrows(EmbeddingFailure.class,() -> provider.embedQuery("q"));
    }
    @Test void onlyTransientHttpFailuresAreRetryable() {
        response="{}";
        for (int code : new int[]{400,401,422,429,503}) {
            status=code;
            assertEquals(code==429 || code==503,assertThrows(EmbeddingFailure.class,() -> provider.embedQuery("q")).retryable());
        }
    }
}
