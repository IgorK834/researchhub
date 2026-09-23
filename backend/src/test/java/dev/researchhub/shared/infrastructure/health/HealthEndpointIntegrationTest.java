package dev.researchhub.shared.infrastructure.health;

import dev.researchhub.shared.infrastructure.persistence.PostgresTestcontainersConfiguration;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.health.actuate.endpoint.HealthEndpointGroups;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.not;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("local")
@Import(PostgresTestcontainersConfiguration.class)
class HealthEndpointIntegrationTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private HealthEndpointGroups healthEndpointGroups;

    @Test
    void localHealthIsUpWhenTheDatabaseIsUp() throws Exception {
        assertUp("/actuator/health");
        assertUp("/actuator/health/readiness");
        assertUp("/actuator/health/liveness");
    }

    @Test
    void readinessIncludesTheDatabaseAndLivenessDoesNot() {
        assertTrue(healthEndpointGroups.get("readiness").isMember("db"),
                "Readiness must include db so a database outage withholds traffic");
        assertFalse(healthEndpointGroups.get("liveness").isMember("db"),
                "Liveness must stay a process check when the database is down");
    }

    @Test
    void healthBodyDoesNotExposeConnectionSecrets() throws Exception {
        mockMvc.perform(get("/actuator/health"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("UP"))
                .andExpect(content().string(not(containsString("jdbc:"))))
                .andExpect(content().string(not(containsString("password"))));
    }

    /**
     * Neither endpoint may be readable without credentials.
     *
     * <p>Two things now keep them out of reach, and either is sufficient: {@code management.endpoints}
     * exposes only {@code health}, so there is no handler mapped (404), and the security filter chain
     * permits only the three health probes, so anything else is rejected before routing (401). The
     * assertion accepts both because which one answers first is an implementation detail; what matters
     * is that the body never arrives.
     */
    @Test
    void environmentEndpointIsNotPublic() throws Exception {
        assertNotReadable("/actuator/env");
        assertNotReadable("/actuator/configprops");
    }

    private void assertUp(String path) throws Exception {
        mockMvc.perform(get(path))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("UP"));
    }

    private void assertNotReadable(String path) throws Exception {
        int status = mockMvc.perform(get(path)).andReturn().getResponse().getStatus();
        assertTrue(status == 404 || status == 401,
                path + " must not be publicly readable, but responded " + status);
    }

}
