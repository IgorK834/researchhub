package dev.researchhub.auth.infrastructure;

import dev.researchhub.shared.error.ApiErrorCode;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ProblemDetail;
import org.springframework.stereotype.Component;
import tools.jackson.databind.ObjectMapper;

import java.io.IOException;
import java.net.URI;

/**
 * Writes the project's {@code ProblemDetail} body from inside the Spring Security filter chain.
 *
 * <p>Security rejects a request in a filter, before the DispatcherServlet runs, so
 * {@code GlobalExceptionHandler} never sees it and Spring Security's own error body would be returned
 * instead. That body has a different shape and no {@code code}, which would give clients two error
 * contracts to handle. This class keeps a single one: the fields and codes in
 * docs/development/api-errors.md.
 */
@Component
public class ProblemDetailErrorWriter {

    private static final URI PROBLEM_TYPE = URI.create("about:blank");

    private final ObjectMapper objectMapper;

    public ProblemDetailErrorWriter(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    public void write(HttpServletRequest request, HttpServletResponse response,
                      HttpStatus status, ApiErrorCode code, String title, String detail) throws IOException {
        if (response.isCommitted()) {
            return;
        }

        ProblemDetail problem = ProblemDetail.forStatusAndDetail(status, detail);
        problem.setType(PROBLEM_TYPE);
        problem.setTitle(title);
        problem.setInstance(URI.create(request.getRequestURI()));
        problem.setProperty("code", code.name());

        response.setStatus(status.value());
        response.setContentType(MediaType.APPLICATION_PROBLEM_JSON_VALUE);
        response.setCharacterEncoding("UTF-8");
        objectMapper.writeValue(response.getOutputStream(), problem);
    }

}
