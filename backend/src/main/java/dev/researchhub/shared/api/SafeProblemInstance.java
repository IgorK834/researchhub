package dev.researchhub.shared.api;

import jakarta.servlet.http.HttpServletRequest;
import java.net.URI;

/** Never echo a bearer invitation secret in ProblemDetail, including security-filter errors. */
public final class SafeProblemInstance {
    private SafeProblemInstance() {}
    public static URI from(HttpServletRequest request) {
        String path=request.getRequestURI();
        return URI.create(path.startsWith("/api/invitations/") ? "/api/invitations/redacted/accept" : path);
    }
}
