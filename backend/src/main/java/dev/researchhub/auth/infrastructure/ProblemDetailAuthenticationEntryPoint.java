package dev.researchhub.auth.infrastructure;

import dev.researchhub.shared.error.ApiErrorCode;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.AuthenticationException;
import org.springframework.security.web.AuthenticationEntryPoint;
import org.springframework.stereotype.Component;

import java.io.IOException;

/**
 * Answers an unauthenticated request to a protected route with {@code 401 UNAUTHENTICATED}.
 *
 * <p>This is what docs/development/api-errors.md means by "security filters should translate framework
 * authentication failures into the application contract". Without it, Spring Security would redirect to
 * a login page or return its own JSON.
 *
 * <p>The detail never says whether the session expired, was never established, or belongs to an account
 * that has since been disabled. All the client needs to know is that it must authenticate again.
 */
@Component
public class ProblemDetailAuthenticationEntryPoint implements AuthenticationEntryPoint {

    private final ProblemDetailErrorWriter errorWriter;

    public ProblemDetailAuthenticationEntryPoint(ProblemDetailErrorWriter errorWriter) {
        this.errorWriter = errorWriter;
    }

    @Override
    public void commence(HttpServletRequest request, HttpServletResponse response,
                         AuthenticationException authException) throws IOException {
        errorWriter.write(request, response, HttpStatus.UNAUTHORIZED,
                ApiErrorCode.UNAUTHENTICATED, "Unauthenticated", "Authentication is required");
    }

}
