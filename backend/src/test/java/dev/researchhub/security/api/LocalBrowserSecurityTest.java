package dev.researchhub.security.api;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest(classes = dev.researchhub.support.HttpSecurityTestApplication.class) @ActiveProfiles("test") @AutoConfigureMockMvc
class LocalBrowserSecurityTest {
    @Autowired MockMvc http;
    @Test void developmentDoesNotSetHstsEvenWhenRequestIsSecure() throws Exception {
        http.perform(get("/actuator/health").secure(true)).andExpect(status().isOk())
            .andExpect(header().doesNotExist("Strict-Transport-Security"))
            .andExpect(cookie().secure("XSRF-TOKEN", false))
            .andExpect(header().string("X-Content-Type-Options", "nosniff"))
            .andExpect(header().string("X-Frame-Options", "DENY"));
    }
    @Test void csrfStillRejectsMutation() throws Exception {
        http.perform(post("/api/auth/login").contentType("application/json").content("{}"))
            .andExpect(status().isForbidden()).andExpect(jsonPath("$.code").value("FORBIDDEN"));
    }
}
