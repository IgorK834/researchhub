package dev.researchhub.security.infrastructure;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import java.util.List;
import static org.junit.jupiter.api.Assertions.*;

class BrowserSecurityPolicyTest {
    private BrowserSecurityPolicy policy(String env, String origin, boolean secure, String sameSite, boolean httpOnly) {
        return new BrowserSecurityPolicy(env, List.of(origin), secure, sameSite, httpOnly);
    }
    @Test void explicitOriginsAndCookieTopologies() {
        assertEquals(List.of("https://app.example.com"), policy("cloud", "https://app.example.com", true, "lax", true).allowedOrigins());
        assertTrue(policy("cloud", "", true, "none", true).hstsEnabled());
        assertFalse(policy("local", "http://localhost:3000", false, "strict", true).hstsEnabled());
        assertFalse(policy("test", "http://127.0.0.1:3000", false, "lax", true).hstsEnabled());
        assertEquals(List.of("http://[::1]:3000"), policy("local", "http://[::1]:3000", false, "lax", true).allowedOrigins());
        assertEquals(List.of(), new BrowserSecurityPolicy("cloud", List.of("", " "), true, "lax", true).allowedOrigins());
        assertEquals(List.of("https://app.example.com"), new BrowserSecurityPolicy("cloud", List.of("https://app.example.com", "https://app.example.com"), true, "lax", true).allowedOrigins());
    }
    @ParameterizedTest @ValueSource(strings = {"*", "https://*.example.com", "null", "http://app.example.com", "http://localhost:3000",
            "https://user:password@app.example.com", "https://app.example.com/", "https://app.example.com/api", "https://app.example.com?secret=x",
            "https://app.example.com#fragment", "https://app.example.com:99999", "file:///private", "not an origin", "wss://app.example.com"})
    void cloudRejectsUnsafeOrigins(String origin) {
        assertThrows(IllegalStateException.class, () -> policy("cloud", origin, true, "lax", true));
    }
    @Test void insecureCookiesCannotBeEnabledInCloudOrUnknownEnvironments() {
        for (String env : List.of("cloud", "production", ""))
            assertThrows(IllegalStateException.class, () -> policy(env, "", false, "lax", true));
        assertThrows(IllegalStateException.class, () -> policy("local", "", false, "none", true));
        assertThrows(IllegalStateException.class, () -> policy("cloud", "", true, "invalid", true));
        assertThrows(IllegalStateException.class, () -> policy("cloud", "", true, "lax", false));
        assertThrows(IllegalStateException.class, () -> policy("local", "http://remote.example.com", false, "lax", true));
    }
}
