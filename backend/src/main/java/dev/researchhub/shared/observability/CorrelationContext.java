package dev.researchhub.shared.observability;

import org.slf4j.MDC;
import org.springframework.http.client.ClientHttpRequestInterceptor;
import java.util.Map;
import java.util.UUID;

/** Bounded diagnostic identifiers only; never credentials, URLs or request bodies. */
public final class CorrelationContext implements AutoCloseable {
    public static final String HEADER = "X-Request-ID";
    private final Map<String, String> previous;

    private CorrelationContext(String requestId, Map<String, String> fields) {
        previous = MDC.getCopyOfContextMap();
        MDC.put("requestId", normalize(requestId));
        fields.forEach(MDC::put);
    }

    public static boolean valid(String value) {
        return value != null && value.matches("[A-Za-z0-9][A-Za-z0-9._-]{0,63}");
    }

    public static String normalize(String value) {
        return valid(value) ? value : UUID.randomUUID().toString();
    }

    public static String currentOrNew() { return normalize(MDC.get("requestId")); }
    public static CorrelationContext open(String id) { return open(id, Map.of()); }
    public static CorrelationContext open(String id, Map<String, String> fields) {
        return new CorrelationContext(id, fields);
    }

    public static ClientHttpRequestInterceptor propagation() {
        return (request, body, execution) -> {
            request.getHeaders().set(HEADER, currentOrNew());
            return execution.execute(request, body);
        };
    }

    @Override public void close() {
        if (previous == null) MDC.clear(); else MDC.setContextMap(previous);
    }
}
