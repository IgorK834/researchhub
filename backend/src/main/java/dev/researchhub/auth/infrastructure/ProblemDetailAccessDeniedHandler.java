package dev.researchhub.auth.infrastructure;

import dev.researchhub.shared.error.ApiErrorCode;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.web.access.AccessDeniedHandler;
import org.springframework.stereotype.Component;

import java.io.IOException;

/**
 * Answers a denied request with {@code 403 FORBIDDEN} in the project's error shape.
 *
 * <p>The common case today is a missing or stale CSRF token on a mutating request, which Spring
 * Security reports as an {@link AccessDeniedException}. Keeping it in the same contract means the SPA
 * reads {@code code} here exactly as it does everywhere else.
 */
@Component
public class ProblemDetailAccessDeniedHandler implements AccessDeniedHandler {

    private final ProblemDetailErrorWriter errorWriter;

    public ProblemDetailAccessDeniedHandler(ProblemDetailErrorWriter errorWriter) {
        this.errorWriter = errorWriter;
    }

    @Override
    public void handle(HttpServletRequest request, HttpServletResponse response,
                       AccessDeniedException accessDeniedException) throws IOException {
        errorWriter.write(request, response, HttpStatus.FORBIDDEN,
                ApiErrorCode.FORBIDDEN, "Forbidden", "You are not allowed to perform this action");
    }

}
