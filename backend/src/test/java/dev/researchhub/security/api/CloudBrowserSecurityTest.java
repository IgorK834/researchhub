package dev.researchhub.security.api;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest(properties = {"DB_URL=jdbc:postgresql://example/researchhub", "BLOB_ENDPOINT=https://example.blob.core.windows.net",
        "researchhub.auth.cors.allowed-origins=https://app.example.com"})
@ActiveProfiles("cloud") @AutoConfigureMockMvc
class CloudBrowserSecurityTest {
    @Autowired MockMvc http;
    @Test void httpsCloudHasHeadersAndSecureCsrfCookiesEvenOnErrors() throws Exception {
        for (String path : new String[]{"/actuator/health", "/api/private"}) {
            http.perform(get(path).secure(true))
                .andExpect(header().string("X-Content-Type-Options", "nosniff"))
                .andExpect(header().string("X-Frame-Options", "DENY"))
                .andExpect(header().string("Strict-Transport-Security", "max-age=31536000"))
                .andExpect(header().string("Content-Security-Policy", dev.researchhub.security.infrastructure.BrowserSecurityPolicy.API_CSP))
                .andExpect(cookie().secure("XSRF-TOKEN", true))
                .andExpect(cookie().httpOnly("XSRF-TOKEN", false))
                .andExpect(cookie().attribute("XSRF-TOKEN", "SameSite", "Lax"));
        }
    }
    @Test void plainHttpAndUntrustedForwardedHeaderCannotEnableHsts() throws Exception {
        http.perform(get("/actuator/health").header("X-Forwarded-Proto", "https"))
            .andExpect(status().isOk()).andExpect(header().doesNotExist("Strict-Transport-Security"));
    }
    @Test void exactCredentialedCorsAllowsCsrfAndExposesQuotaRetryHeader() throws Exception {
        http.perform(options("/api/auth/login").header("Origin", "https://app.example.com")
                .header("Access-Control-Request-Method", "POST").header("Access-Control-Request-Headers", "Content-Type,X-XSRF-TOKEN"))
            .andExpect(status().isOk()).andExpect(header().string("Access-Control-Allow-Origin", "https://app.example.com"))
            .andExpect(header().string("Access-Control-Allow-Credentials", "true"))
            .andExpect(header().string("Access-Control-Expose-Headers", "Retry-After, X-Request-ID"));
        for (String origin : new String[]{"https://evil.example.com", "http://localhost:3000", "null"}) {
            http.perform(options("/api/auth/login").header("Origin", origin).header("Access-Control-Request-Method", "POST"))
                .andExpect(status().isForbidden()).andExpect(header().doesNotExist("Access-Control-Allow-Origin"));
        }
    }
}
