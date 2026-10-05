package dev.researchhub.analysis.infrastructure;

import com.sun.net.httpserver.HttpServer;
import dev.researchhub.analysis.application.AnalysisContracts.*;
import dev.researchhub.ai.application.ModelFailure;
import dev.researchhub.shared.error.ApiErrorCode;
import org.junit.jupiter.api.*;
import tools.jackson.databind.json.JsonMapper;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.time.Duration;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;
import static org.junit.jupiter.api.Assertions.*;

class HttpAnalysisPlannerTest {
    final JsonMapper json=JsonMapper.builder().findAndAddModules().build();
    final String token="planning-test-service-token-at-least-32-characters";
    HttpServer server;
    PlanningRequest request;
    String candidate;
    @BeforeEach void prepare() throws Exception {
        Path root=Path.of("../contracts/analysis/computation-plan/v1");
        request=json.readValue(Files.readString(root.resolve("request.json")),PlanningRequest.class);
        candidate=Files.readString(root.resolve("candidate.json"));
        server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);server.start();
    }
    @AfterEach void stop() { server.stop(0); }
    URI address() { return URI.create("http://127.0.0.1:"+server.getAddress().getPort()); }
    HttpAnalysisPlanner planner() { return new HttpAnalysisPlanner(json,address(),token,Duration.ofSeconds(2)); }
    void reply(int status,String body,AtomicInteger calls) {
        server.createContext("/internal/analysis/plan",exchange -> {
            calls.incrementAndGet();
            assertEquals("Bearer "+token,exchange.getRequestHeaders().getFirst("Authorization"));
            assertEquals(request,json.readValue(exchange.getRequestBody().readAllBytes(),PlanningRequest.class));
            exchange.getResponseHeaders().add("Content-Type","application/json");
            exchange.getResponseHeaders().add("Location",address()+"/must-not-follow");
            byte[] bytes=body.getBytes(StandardCharsets.UTF_8);exchange.sendResponseHeaders(status,bytes.length);
            exchange.getResponseBody().write(bytes);exchange.close();
        });
    }
    @Test void roundTripsTheExplicitWorkerContractWithOneAuthenticatedCall() {
        var calls=new AtomicInteger();reply(200,candidate,calls);
        assertEquals(json.readValue(candidate,Candidate.class),planner().plan(request));assertEquals(1,calls.get());
    }
    @Test void rejectsMalformedUnknownOversizedAndNullResponses() {
        for (String body:List.of("{invalid","null",candidate.replace("\"schemaVersion\": \"1.0\"","\"schemaVersion\": \"2.0\""),
            candidate.replace("\"output\":", "\"extra\": true, \"output\":"),candidate+" {}","x".repeat(256*1024+1))) {
            var calls=new AtomicInteger();reply(200,body,calls);
            assertEquals(ApiErrorCode.AI_OUTPUT_INVALID,assertThrows(ModelFailure.class,() -> planner().plan(request)).code());
            assertEquals(1,calls.get());server.removeContext("/internal/analysis/plan");
        }
    }
    @Test void mapsOnlyAllowlistedErrorsAndDoesNotFollowRedirectsOrRetry() {
        int[] statuses={422,408,429,503,504,401,500,302,502,502,502};
        String[] bodies={"secret","secret","secret","secret","secret","secret","secret","secret","{\"code\":\"AI_OUTPUT_INVALID\"}","{\"code\":\"secret\"}","not json"};
        for (int i=0;i<statuses.length;i++) {
            var calls=new AtomicInteger();reply(statuses[i],bodies[i],calls);
            var error=assertThrows(ModelFailure.class,() -> planner().plan(request));
            assertEquals(i==0 ? ApiErrorCode.AI_REFUSED : i<5 ? ApiErrorCode.AI_UNAVAILABLE : i==8 ? ApiErrorCode.AI_OUTPUT_INVALID : ApiErrorCode.AI_PROVIDER_ERROR,error.code());
            assertFalse(error.getMessage().contains("secret"));assertNull(error.getCause());assertEquals(1,calls.get());
            server.removeContext("/internal/analysis/plan");
        }
    }
    @Test void connectionFailureIsTransientAndHasNoProviderDetails() {
        var adapter=new HttpAnalysisPlanner(json,URI.create("http://127.0.0.1:1"),token,Duration.ofMillis(100));
        assertEquals(ApiErrorCode.AI_UNAVAILABLE,assertThrows(ModelFailure.class,() -> adapter.plan(request)).code());
    }
    @Test void unsafeConnectionsFailBeforeAnyNetworkAccess() {
        for (String uri:List.of("file:/tmp/worker","http://user:secret@localhost","http://localhost?token=secret","http://localhost#fragment","ftp://localhost"))
            assertThrows(IllegalArgumentException.class,() -> new HttpAnalysisPlanner(json,URI.create(uri),token,Duration.ofSeconds(1)));
        assertThrows(IllegalArgumentException.class,() -> new HttpAnalysisPlanner(json,null,token,Duration.ofSeconds(1)));
        for (String bad:List.of("short"," "+token)) assertThrows(IllegalArgumentException.class,() -> new HttpAnalysisPlanner(json,address(),bad,Duration.ofSeconds(1)));
        assertThrows(IllegalArgumentException.class,() -> new HttpAnalysisPlanner(json,address(),null,Duration.ofSeconds(1)));
        for (Duration bad:List.of(Duration.ZERO,Duration.ofSeconds(-1))) assertThrows(IllegalArgumentException.class,() -> new HttpAnalysisPlanner(json,address(),token,bad));
        assertThrows(IllegalArgumentException.class,() -> new HttpAnalysisPlanner(json,address(),token,null));
    }
}
