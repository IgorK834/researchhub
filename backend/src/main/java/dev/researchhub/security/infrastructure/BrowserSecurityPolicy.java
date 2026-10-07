package dev.researchhub.security.infrastructure;

import java.net.URI;
import java.util.List;
import java.util.Set;

/** Validates the effective browser settings, including overrides of servlet cookie properties. */
public record BrowserSecurityPolicy(String environment, List<String> allowedOrigins,
                                    boolean secureCookies, String sameSite, boolean httpOnly) {
    public static final String API_CSP = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";

    public BrowserSecurityPolicy {
        boolean development = Set.of("local", "test").contains(environment);
        if (!httpOnly || !Set.of("lax", "strict", "none").contains(sameSite)
                || (!secureCookies && (!development || "none".equals(sameSite)))) {
            throw new IllegalStateException("Session cookies require HttpOnly, a valid SameSite policy and Secure outside local/test; SameSite=None requires Secure");
        }
        allowedOrigins = allowedOrigins.stream().filter(value -> !value.isBlank()).distinct().toList();
        for (String value : allowedOrigins) {
            URI origin;
            try { origin = URI.create(value); }
            catch (IllegalArgumentException invalid) { throw new IllegalStateException("CORS requires explicit HTTP(S) origins", invalid); }
            boolean loopback = Set.of("localhost", "127.0.0.1", "[::1]").contains(origin.getHost() == null ? "" : origin.getHost());
            if (value.contains("*") || origin.getHost() == null || origin.getRawUserInfo() != null
                    || origin.getRawQuery() != null || origin.getRawFragment() != null
                    || !origin.getRawPath().isEmpty() || origin.getPort() > 65535
                    || !("https".equals(origin.getScheme()) || development && loopback && "http".equals(origin.getScheme()))) {
                throw new IllegalStateException("CORS requires explicit HTTPS origins (HTTP loopback only in local/test); wildcards, paths and credentials are forbidden");
            }
        }
    }

    public boolean hstsEnabled() { return "cloud".equals(environment); }
}
