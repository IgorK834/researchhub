package dev.researchhub.auth.infrastructure;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.web.context.HttpSessionSecurityContextRepository;

import java.util.Optional;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class BrowserSessionTest {
    private final BrowserSession session = new BrowserSession(new HttpSessionSecurityContextRepository());

    @AfterEach void clearRequestIdentity() { SecurityContextHolder.clearContext(); }

    @Test void untrustedOrUnauthenticatedPrincipalsCannotBecomeResearchHubIdentity() {
        assertEquals(Optional.empty(), session.currentUserId());
        SecurityContextHolder.getContext().setAuthentication(
                UsernamePasswordAuthenticationToken.unauthenticated(UUID.randomUUID().toString(), "password"));
        assertEquals(Optional.empty(), session.currentUserId());
        var authentication = mock(Authentication.class);
        when(authentication.isAuthenticated()).thenReturn(true);
        SecurityContextHolder.getContext().setAuthentication(authentication);
        assertEquals(Optional.empty(), session.currentUserId(), "A null name is not an identity");
        when(authentication.getName()).thenReturn("anonymousUser");
        assertEquals(Optional.empty(), session.currentUserId(), "An arbitrary string is not an identity");
        UUID user = UUID.randomUUID();
        when(authentication.getName()).thenReturn(user.toString());
        assertEquals(Optional.of(user), session.currentUserId());
    }

    @Test void endingAnAnonymousRequestDoesNotCreateASession() {
        var request = new MockHttpServletRequest();
        assertEquals(Optional.empty(), session.end(request));
        assertNull(request.getSession(false));
        assertNull(SecurityContextHolder.getContext().getAuthentication());
    }
}
