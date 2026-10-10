package dev.researchhub.collaboration.infrastructure;

import com.sun.net.httpserver.HttpServer;
import dev.researchhub.ai.application.CanvasContracts.*;
import dev.researchhub.document.application.CanvasTargets.*;
import dev.researchhub.document.application.DocumentSnapshotState;
import dev.researchhub.shared.error.*;
import org.junit.jupiter.api.*;
import tools.jackson.databind.ObjectMapper;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

class HttpCanvasPositionResolverTest {
    HttpServer server;HttpCanvasPositionResolver resolver;String response;int status=200;
    final ObjectMapper json=new ObjectMapper();
    final Endpoint point=new Endpoint(null,List.of(0),1);
    final Relative relative=new Relative("AA==","AQ==");
    final DocumentSnapshotState.State state=new DocumentSnapshotState.State(new byte[]{1,2},"hash",0,1);
    @BeforeEach void setup() throws Exception {
        server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
        server.createContext("/internal/canvas/resolve",exchange->{
            assertEquals("POST",exchange.getRequestMethod());assertEquals("service-key",exchange.getRequestHeaders().getFirst("X-Collaboration-Service-Token"));
            assertNull(exchange.getRequestHeaders().getFirst("Upgrade"));
            var input=json.readTree(new String(exchange.getRequestBody().readAllBytes(),StandardCharsets.UTF_8));assertEquals("AQI=",input.path("state").asString());
            byte[] bytes=response.getBytes(StandardCharsets.UTF_8);exchange.sendResponseHeaders(status,bytes.length);exchange.getResponseBody().write(bytes);exchange.close();
        });server.start();var config=new CollaborationProperties();config.setInternalUrl("http://127.0.0.1:"+server.getAddress().getPort());config.setServiceToken("service-key");
        resolver=new HttpCanvasPositionResolver(config,json);response=json.writeValueAsString(new Resolution(point,point,relative));
    }
    @AfterEach void stop(){server.stop(0);Thread.interrupted();}
    @Test void authenticatesFrozenStateForBothRelativeResolutionAndReaderPinning(){
        assertEquals(point,resolver.resolve(state,relative,"AA==").start());
        var target=new Target(Kind.CARET,point,point,"a".repeat(64));assertEquals(relative,resolver.pin(state,target).relative());
        response="{\"start\":{\"blockId\":null,\"path\":[0],\"offset\":1},\"end\":{\"blockId\":null,\"path\":[0],\"offset\":1}}";
        assertEquals(point,resolver.resolve(state,relative,null).start());
    }
    @Test void reportsStaleSeparatelyFromUnavailableOrMalformedReplies(){
        status=409;assertEquals(ApiErrorCode.CONFLICT,assertThrows(ApiException.class,()->resolver.resolve(state,relative,null)).code());
        status=503;assertEquals(ApiErrorCode.AI_UNAVAILABLE,assertThrows(ApiException.class,()->resolver.resolve(state,relative,null)).code());
        status=200;for(var invalid:List.of("broken JSON","null","{}","{\"start\":null,\"end\":null}")){
            response=invalid;assertEquals(ApiErrorCode.AI_UNAVAILABLE,assertThrows(ApiException.class,()->resolver.resolve(state,relative,null)).code());
        }
    }
    @Test void handlesConnectionFailureAndPreservesInterruption(){
        server.stop(0);assertEquals(ApiErrorCode.AI_UNAVAILABLE,assertThrows(ApiException.class,()->resolver.resolve(state,relative,null)).code());
        Thread.currentThread().interrupt();assertThrows(ApiException.class,()->resolver.resolve(state,relative,null));assertTrue(Thread.currentThread().isInterrupted());
    }
}
