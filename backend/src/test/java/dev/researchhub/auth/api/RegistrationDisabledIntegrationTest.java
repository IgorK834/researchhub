package dev.researchhub.auth.api;

import dev.researchhub.ai.application.ModelProvider;
import dev.researchhub.ai.application.GenerationContracts.ModelMetadata;
import dev.researchhub.shared.infrastructure.persistence.PostgresTestcontainersConfiguration;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.jdbc.core.JdbcTemplate;
import static org.mockito.Mockito.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest(properties={"researchhub.collaboration.service-token=test-collaboration-token-with-32-characters","researchhub.processing.dispatcher.enabled=false","researchhub.export.dispatcher.enabled=false","researchhub.analysis.execution.dispatcher.enabled=false"})
@AutoConfigureMockMvc @ActiveProfiles("demo") @Import(PostgresTestcontainersConfiguration.class)
class RegistrationDisabledIntegrationTest {
    @Autowired MockMvc http;
    @Autowired JdbcTemplate jdbc;
    @MockitoBean dev.researchhub.ai.infrastructure.HttpModelProvider model;
    @Test void publicConfigurationIsAnonymousCacheableAndContainsOnlyNonSecretFacts() throws Exception {
        when(model.modelMetadata()).thenReturn(new ModelMetadata("deterministic","extractive-fixture","1",true,false));
        var response=http.perform(get("/api/public/config")).andExpect(status().isOk())
            .andExpect(header().string("Cache-Control","max-age=60, public")).andExpect(jsonPath("$.environment").value("demo"))
            .andExpect(jsonPath("$.demo").value(true)).andExpect(jsonPath("$.registrationMode").value("disabled"))
            .andExpect(jsonPath("$.ai.mode").value("deterministic")).andReturn().getResponse();
        var body=new tools.jackson.databind.ObjectMapper().readTree(response.getContentAsString());
        assertEquals(4,body.size());assertEquals(2,body.get("ai").size());
        assertNull(response.getCookie("JSESSIONID"));
        assertFalse(response.getContentAsString().contains("token"));assertFalse(response.getContentAsString().contains("http"));
    }
    @Test void closedApiDoesNotCreateAnAccountOrExposeAnEmailAndPersistsAnonymousAudit() throws Exception {
        dev.researchhub.workspace.UserRowFixture.insertUser(jdbc, "existing@example.test", "Existing researcher");
        for (String email:new String[]{"new@example.test","existing@example.test"}) {
            http.perform(post("/api/auth/register").with(csrf()).header("X-Request-ID","closed-registration-test").contentType("application/json")
                .content("{\"email\":\""+email+"\",\"password\":\"correct-horse-battery-staple\",\"displayName\":\"Researcher\"}"))
                .andExpect(status().isForbidden()).andExpect(jsonPath("$.code").value("FORBIDDEN"))
                .andExpect(jsonPath("$.detail").value("Account registration is disabled"));
        }
        assertEquals(1,jdbc.queryForObject("SELECT count(*) FROM users",Integer.class));
        assertEquals(2,jdbc.queryForObject("SELECT count(*) FROM registration_rejections WHERE request_id='closed-registration-test' AND mode='disabled'",Integer.class));
    }
    @Test void trustedHttpsProxyPreservesSameOriginWhileForeignOriginsAreRejected() throws Exception {
        http.perform(get("/api/auth/csrf").header("Host", "localhost:8443")
                .header("Origin", "https://localhost:8443")
                .header("X-Forwarded-Proto", "https").header("X-Forwarded-Host", "localhost:8443"))
                .andExpect(status().isNoContent());
        http.perform(get("/api/auth/csrf").header("Host", "localhost:8443")
                .header("Origin", "https://foreign.example.test")
                .header("X-Forwarded-Proto", "https").header("X-Forwarded-Host", "localhost:8443"))
                .andExpect(status().isForbidden());
    }
}
