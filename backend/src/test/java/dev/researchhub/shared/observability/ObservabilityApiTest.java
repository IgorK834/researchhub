package dev.researchhub.shared.observability;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import static org.hamcrest.Matchers.containsString;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest(classes = dev.researchhub.support.HttpSecurityTestApplication.class, properties="researchhub.observability.scrape-token=test-metrics-token-at-least-32-characters")
@org.springframework.boot.micrometer.metrics.test.autoconfigure.AutoConfigureMetrics
@AutoConfigureMockMvc @ActiveProfiles("test")
class ObservabilityApiTest {
    private static final String TOKEN="test-metrics-token-at-least-32-characters";
    @Autowired MockMvc mvc;
    @Test void correlationCoversPublicAndRejectedRequests() throws Exception {
        mvc.perform(get("/actuator/health").header("X-Request-ID","health-123"))
            .andExpect(status().isOk()).andExpect(header().string("X-Request-ID","health-123"));
        mvc.perform(get("/api/private").header("X-Request-ID","private-123"))
            .andExpect(status().isUnauthorized()).andExpect(header().string("X-Request-ID","private-123"));
    }
    @Test void exporterRequiresDedicatedBearerCredentialAndExposesHttpMetrics() throws Exception {
        mvc.perform(get("/actuator/health"));
        mvc.perform(get("/actuator/prometheus")).andExpect(status().isUnauthorized());
        mvc.perform(get("/actuator/prometheus").header("Authorization","Bearer wrong"))
            .andExpect(status().isUnauthorized());
        mvc.perform(get("/actuator/prometheus").with(org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user("browser")))
            .andExpect(status().isUnauthorized());
        mvc.perform(get("/actuator/prometheus").header("Authorization","Bearer "+TOKEN))
            .andExpect(status().isOk()).andExpect(content().string(containsString("http_server_requests_seconds_count")));
        mvc.perform(post("/actuator/prometheus").header("Authorization","Bearer "+TOKEN)).andExpect(status().isUnauthorized());
        mvc.perform(get("/actuator/env").header("Authorization","Bearer "+TOKEN)).andExpect(status().isUnauthorized());
    }
}
