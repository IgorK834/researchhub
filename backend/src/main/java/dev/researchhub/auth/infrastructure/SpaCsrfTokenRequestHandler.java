package dev.researchhub.auth.infrastructure;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.security.web.csrf.CsrfToken;
import org.springframework.security.web.csrf.CsrfTokenRequestAttributeHandler;
import org.springframework.security.web.csrf.CsrfTokenRequestHandler;
import org.springframework.security.web.csrf.XorCsrfTokenRequestAttributeHandler;
import org.springframework.util.StringUtils;

import java.util.function.Supplier;

/**
 * Makes CSRF tokens work for a JavaScript client that reads the token from a cookie.
 *
 * <p>Two Spring Security defaults collide with that arrangement:
 *
 * <ul>
 *   <li>The token is normally XOR-masked per response to blunt the BREACH compression side channel.
 *       The masked value is what a server-rendered form sends back. An SPA, however, reads the raw
 *       value out of the {@code XSRF-TOKEN} cookie, so a masked value is not what arrives in the
 *       header.
 *   <li>Tokens are loaded lazily, so no cookie is written until something actually asks for the
 *       token.
 * </ul>
 *
 * <p>So: keep the masking when rendering (the cookie still gets a usable value), and when resolving,
 * treat a value that came in through the header as raw and anything else as masked. This is the
 * arrangement Spring Security's own documentation recommends for single-page applications.
 */
final class SpaCsrfTokenRequestHandler implements CsrfTokenRequestHandler {

    private final CsrfTokenRequestHandler plain = new CsrfTokenRequestAttributeHandler();
    private final CsrfTokenRequestHandler masked = new XorCsrfTokenRequestAttributeHandler();

    @Override
    public void handle(HttpServletRequest request, HttpServletResponse response,
                       Supplier<CsrfToken> csrfToken) {
        this.masked.handle(request, response, csrfToken);
        // Force the deferred token to load, so the repository writes the cookie on this response
        // instead of waiting for a caller that may never ask.
        csrfToken.get();
    }

    @Override
    public String resolveCsrfTokenValue(HttpServletRequest request, CsrfToken csrfToken) {
        String headerValue = request.getHeader(csrfToken.getHeaderName());
        // A header means the SPA copied the raw cookie value; a parameter means a rendered form sent
        // the masked one.
        return StringUtils.hasText(headerValue)
                ? this.plain.resolveCsrfTokenValue(request, csrfToken)
                : this.masked.resolveCsrfTokenValue(request, csrfToken);
    }

}
