package dev.researchhub.shared.observability;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.LoggerFactory;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;
import org.springframework.web.servlet.HandlerMapping;
import java.io.IOException;

/** Runs before security so rejected requests are correlated too. */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE + 10)
public class RequestCorrelationFilter extends OncePerRequestFilter {
    private static final String ATTRIBUTE = RequestCorrelationFilter.class.getName() + ".id";
    @Override protected boolean shouldNotFilterAsyncDispatch() { return false; }
    @Override protected boolean shouldNotFilterErrorDispatch() { return false; }

    @Override protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
                                             FilterChain chain) throws IOException, ServletException {
        String id = (String) request.getAttribute(ATTRIBUTE);
        if (id == null) {
            var values = request.getHeaders(CorrelationContext.HEADER);
            String supplied = values.hasMoreElements() ? values.nextElement() : null;
            id = CorrelationContext.normalize(values.hasMoreElements() ? null : supplied);
            request.setAttribute(ATTRIBUTE, id);
        }
        response.setHeader(CorrelationContext.HEADER, id);
        try (var ignored = CorrelationContext.open(id)) {
            try { chain.doFilter(request, response); }
            finally {
                // Route templates omit IDs/query strings; unknown paths never enter the logs.
                Object route = request.getAttribute(HandlerMapping.BEST_MATCHING_PATTERN_ATTRIBUTE);
                LoggerFactory.getLogger(getClass()).atInfo().addKeyValue("event", "http.request.completed")
                    .addKeyValue("route", route == null ? "UNKNOWN" : route.toString())
                    .addKeyValue("status", response.getStatus()).log("HTTP request completed");
            }
        }
    }
}
