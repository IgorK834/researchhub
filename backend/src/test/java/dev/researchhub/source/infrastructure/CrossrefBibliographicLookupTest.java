package dev.researchhub.source.infrastructure;

import com.sun.net.httpserver.HttpServer;
import dev.researchhub.shared.error.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;
import org.junit.jupiter.api.*;
import tools.jackson.databind.json.JsonMapper;
import static org.junit.jupiter.api.Assertions.*;

class CrossrefBibliographicLookupTest {
    private HttpServer server;
    private ExecutorService executor;
    private final AtomicInteger calls=new AtomicInteger();
    private volatile int status;
    private volatile String body,location,userAgent,path;
    private volatile long delayMillis;
    private final java.util.List<CrossrefBibliographicLookup> clients=new java.util.ArrayList<>();

    @BeforeEach void start() throws Exception {
        status=200;body="{}";location=null;delayMillis=0;
        server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
        executor=Executors.newCachedThreadPool();server.setExecutor(executor);
        server.createContext("/works",exchange -> {
            calls.incrementAndGet();path=exchange.getRequestURI().getRawPath();userAgent=exchange.getRequestHeaders().getFirst("User-Agent");
            try {
                if(delayMillis>0)Thread.sleep(delayMillis);
                byte[] response=body.getBytes(StandardCharsets.UTF_8);
                if(location!=null)exchange.getResponseHeaders().set("Location",location);
                exchange.getResponseHeaders().set("Content-Type","application/json");
                exchange.sendResponseHeaders(status,response.length);
                try(var output=exchange.getResponseBody()){output.write(response);}
            } catch(InterruptedException interrupted){Thread.currentThread().interrupt();}
            catch(java.io.IOException disconnected){/* Expected when a timeout closes the test request. */}
            finally {exchange.close();}
        });
        server.start();
    }
    @AfterEach void stop(){
        clients.forEach(CrossrefBibliographicLookup::close);
        if(server!=null)server.stop(0);
        if(executor!=null)executor.shutdownNow();
    }
    private CrossrefBibliographicLookup provider(Duration timeout) {
        var result=new CrossrefBibliographicLookup(JsonMapper.builder().build(),true,"research@example.org",timeout,
            URI.create("http://127.0.0.1:"+server.getAddress().getPort()));
        clients.add(result);return result;
    }

    @Test void mapsSuccessfulBoundedCrossrefResponseToAnEditableSuggestion() {
        body="""
            {"status":"ok","message":{"title":["Solar efficiency"],
             "author":[{"given":"Jane","family":"Smith"},{"name":"Research Group"}],
             "published-print":{"date-parts":[[2025,4]]},"container-title":["Energy Journal"],
             "DOI":"10.1234/ABC","URL":"https://example.org/paper"}}
            """;
        var result=provider(Duration.ofSeconds(2)).lookup("10.1234/abc").orElseThrow();
        assertEquals("Solar efficiency",result.title());assertEquals(java.util.List.of("Smith, Jane","Research Group"),result.authors());
        assertEquals(2025,result.publicationYear());assertEquals("Energy Journal",result.venue());assertEquals("10.1234/abc",result.doi());
        assertEquals("https://example.org/paper",result.url());assertTrue(result.citationKey().startsWith("SmithJane2025_"));
        assertEquals("ResearchHub/1.0 (mailto:research@example.org)",userAgent);
        assertTrue(path.equals("/works/10.1234%2Fabc") || path.equals("/works/10.1234/abc"),path);
    }

    @Test void unknownDoiIsEmptyAndRedirectsAreNeverFollowed() {
        status=404;assertTrue(provider(Duration.ofSeconds(2)).lookup("10.1234/missing").isEmpty());
        status=302;location="http://127.0.0.1:"+server.getAddress().getPort()+"/works/10.1234/redirected";
        var failure=assertThrows(ApiException.class,()->provider(Duration.ofSeconds(2)).lookup("10.1234/redirect"));
        assertEquals(ApiErrorCode.METADATA_LOOKUP_FAILED,failure.code());assertEquals(2,calls.get());
    }

    @Test void timeoutAndOversizedResponsesFailWithoutLeakingProviderData() {
        delayMillis=250;
        var timeout=assertThrows(ApiException.class,()->provider(Duration.ofMillis(40)).lookup("10.1234/slow"));
        assertEquals(ApiErrorCode.METADATA_LOOKUP_FAILED,timeout.code());
        delayMillis=0;body="x".repeat(CrossrefBibliographicLookup.MAX_RESPONSE_BYTES+1);
        var oversized=assertThrows(ApiException.class,()->provider(Duration.ofSeconds(2)).lookup("10.1234/large"));
        assertEquals(ApiErrorCode.METADATA_LOOKUP_FAILED,oversized.code());assertFalse(oversized.getMessage().contains("xxx"));
    }

    @Test void disabledAndInvalidConfigurationNeverReachTheNetwork() {
        var disabled=new CrossrefBibliographicLookup(JsonMapper.builder().build(),false,"",Duration.ofSeconds(1),
            URI.create("http://127.0.0.1:"+server.getAddress().getPort()));clients.add(disabled);
        assertFalse(disabled.available());assertEquals(ApiErrorCode.METADATA_LOOKUP_UNAVAILABLE,
            assertThrows(ApiException.class,()->disabled.lookup("10.1234/a")).code());assertEquals(0,calls.get());
        assertThrows(IllegalArgumentException.class,()->new CrossrefBibliographicLookup(JsonMapper.builder().build(),true,"",Duration.ofSeconds(1),URI.create("http://localhost")));
        assertThrows(IllegalArgumentException.class,()->new CrossrefBibliographicLookup(JsonMapper.builder().build(),false,"",Duration.ZERO,URI.create("http://localhost")));
    }
}
