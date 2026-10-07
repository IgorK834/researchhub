package dev.researchhub.shared.observability;

import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import jakarta.servlet.DispatcherType;
import jakarta.servlet.ServletException;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.slf4j.MDC;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.web.servlet.HandlerMapping;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicReference;
import static org.junit.jupiter.api.Assertions.*;

class ObservabilityTest {
    @AfterEach void clear() { MDC.clear(); }
    @Test void identifiersAreBoundedAndScopesRestoreEvenOnFailure() {
        for (String value : new String[] {null,"","a\nb","Bearer private","x".repeat(65),"ąć"}) {
            assertFalse(CorrelationContext.valid(value));
            UUID.fromString(CorrelationContext.normalize(value));
        }
        assertTrue(CorrelationContext.valid("R_123.ab-c"));
        try (var outer=CorrelationContext.open("outer")) {
            assertEquals("outer",CorrelationContext.currentOrNew());
            assertThrows(IllegalStateException.class,() -> {
                try (var inner=CorrelationContext.open("inner",Map.of("jobId","job"))) {
                    assertEquals("inner",MDC.get("requestId")); throw new IllegalStateException();
                }
            });
            assertEquals("outer",MDC.get("requestId")); assertNull(MDC.get("jobId"));
        }
        assertNull(MDC.get("requestId"));
        UUID.fromString(CorrelationContext.currentOrNew());
    }
    @Test void filterAcceptsCreatesAndRestoresIdsIncludingAsyncRedispatchAndFailures() throws Exception {
        var filter=new RequestCorrelationFilter();
        var request=new MockHttpServletRequest(); var response=new MockHttpServletResponse();
        request.addHeader(CorrelationContext.HEADER,"incoming-1");
        request.setAttribute(HandlerMapping.BEST_MATCHING_PATTERN_ATTRIBUTE,"/api/sources/{sourceId}");
        MDC.put("parent","preserved");
        filter.doFilter(request,response,(req,res) -> assertEquals("incoming-1",MDC.get("requestId")));
        assertEquals("incoming-1",response.getHeader(CorrelationContext.HEADER));
        assertNull(MDC.get("requestId")); assertEquals("preserved",MDC.get("parent"));
        request.setDispatcherType(DispatcherType.ASYNC);
        request.setAsyncStarted(true);
        filter.doFilter(request,response,(req,res) -> assertEquals("incoming-1",MDC.get("requestId")));
        assertFalse(filter.shouldNotFilterAsyncDispatch()); assertFalse(filter.shouldNotFilterErrorDispatch());
        var repeated=new MockHttpServletRequest(); repeated.addHeader(CorrelationContext.HEADER,"one");
        repeated.addHeader(CorrelationContext.HEADER,"two"); var generated=new MockHttpServletResponse();
        assertThrows(ServletException.class,() -> filter.doFilter(repeated,generated,(req,res) -> { throw new ServletException("private"); }));
        UUID.fromString(generated.getHeader(CorrelationContext.HEADER)); assertNull(MDC.get("requestId"));
        var absent=new MockHttpServletResponse();
        filter.doFilter(new MockHttpServletRequest(),absent,(req,res) -> {});
        UUID.fromString(absent.getHeader(CorrelationContext.HEADER));
    }
    @Test void metricDimensionsAreClosedAndQueueGaugesIncludeZeros() {
        var registry=new SimpleMeterRegistry(); var metrics=new WorkMetrics(registry);
        for (var op:WorkMetrics.Operation.values()) {
            metrics.finish(metrics.start(),op,true); metrics.finish(metrics.start(),op,false);
            assertEquals(1,registry.get(op.name).tag("outcome","success").timer().count());
            assertEquals(1,registry.get(op.name).tag("outcome","failure").timer().count());
        }
        assertEquals("ok",metrics.ai(() -> "ok"));
        assertThrows(IllegalArgumentException.class,() -> metrics.ai(() -> {throw new IllegalArgumentException("secret");}));
        metrics.failure(WorkMetrics.Queue.SOURCE_INGEST);
        metrics.retry(WorkMetrics.Queue.SOURCE_INGEST,WorkMetrics.RetryReason.FAILURE);
        assertEquals(1,registry.get("researchhub.worker.failures").counter().count());
        assertEquals(1,registry.get("researchhub.worker.retries").counter().count());
        var counts=new AtomicReference<>(Map.of("RUNNING",3L,"private-user-label",9L));
        var queue=new QueueMetrics(registry,"SOURCE_INGEST",List.of("PENDING","RUNNING"),counts::get);
        assertEquals(3,registry.get("researchhub.jobs.queue").tag("status","RUNNING").gauge().value());
        assertEquals(0,registry.get("researchhub.jobs.queue").tag("status","PENDING").gauge().value());
        var analysisQueue=new QueueMetrics(registry,"ANALYSIS_EXECUTION",List.of("QUEUED","RUNNING"),() -> Map.of("QUEUED",2L));
        assertEquals(2,registry.get("researchhub.jobs.queue").tags("queue","ANALYSIS_EXECUTION","status","QUEUED").gauge().value());
        assertEquals(3,registry.get("researchhub.jobs.queue").tags("queue","SOURCE_INGEST","status","RUNNING").gauge().value());
        counts.set(Map.of()); queue.refresh();
        assertEquals(0,registry.get("researchhub.jobs.queue").tag("status","RUNNING").gauge().value());
        assertTrue(registry.getMeters().stream().flatMap(m -> m.getId().getTags().stream())
            .noneMatch(t -> t.getValue().contains("private")));
    }
    @Test void outboundPropagationUsesOnlyTheDiagnosticHeader() throws Exception {
        var request=new org.springframework.mock.http.client.MockClientHttpRequest();
        try (var ignored=CorrelationContext.open("outbound")) {
            CorrelationContext.propagation().intercept(request,new byte[0],(req,body) -> {
                assertEquals("outbound",req.getHeaders().getFirst(CorrelationContext.HEADER));
                assertNull(req.getHeaders().getFirst("Authorization"));
                return new org.springframework.mock.http.client.MockClientHttpResponse(new byte[0],200);
            });
        }
    }
}
