package dev.researchhub.shared.observability;

import org.junit.jupiter.api.Test;
import org.springframework.boot.SpringApplication;
import org.springframework.mock.env.MockEnvironment;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.test.util.ReflectionTestUtils;
import static org.junit.jupiter.api.Assertions.*;

class ReplicaIdentityTest {
    @Test void hostnameDefaultAndExplicitIdentityAreResolvedBeforeLogging() {
        var processor = new ReplicaEnvironmentPostProcessor();
        var defaults = new MockEnvironment();
        processor.postProcessEnvironment(defaults, new SpringApplication());
        assertEquals(ReplicaEnvironmentPostProcessor.hostname(), defaults.getProperty("researchhub.instance-id"));
        var explicit = new MockEnvironment().withProperty("researchhub.instance-id", "backend-2");
        processor.postProcessEnvironment(explicit, new SpringApplication());
        assertEquals("backend-2", explicit.getProperty("researchhub.instance-id"));
        assertTrue(processor.getOrder() < 0);
        for (String invalid : new String[]{"", "bad\r\nheader", "x".repeat(129)}) {
            var environment = new MockEnvironment().withProperty("researchhub.instance-id", invalid);
            assertThrows(IllegalStateException.class, () -> processor.postProcessEnvironment(environment, new SpringApplication()));
        }
    }
    @Test void replicaHeaderCoversSuccessAndRejectedRequests() throws Exception {
        var filter = new RequestCorrelationFilter();
        ReflectionTestUtils.setField(filter, "replicaId", "backend-1");
        for (int status : new int[]{200, 401, 403, 500}) {
            var response = new MockHttpServletResponse();
            filter.doFilter(new MockHttpServletRequest(), response, (request, result) -> response.setStatus(status));
            assertEquals("backend-1", response.getHeader("X-Replica-Id"));
        }
    }
}
