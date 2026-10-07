package dev.researchhub.security.api;

import dev.researchhub.shared.infrastructure.persistence.PostgresTestcontainersConfiguration;
import dev.researchhub.user.application.RegisterUserCommand;
import dev.researchhub.user.application.UserRegistrationService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.ActiveProfiles;
import java.net.URI;
import java.net.http.*;
import static org.junit.jupiter.api.Assertions.*;

/** Uses local persistence because the cloud profile is still a scaffold; effective browser policy is cloud. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = {
    "researchhub.environment=cloud", "researchhub.auth.cors.allowed-origins=", "server.servlet.session.cookie.secure=true",
    "server.servlet.session.cookie.same-site=none", "researchhub.processing.dispatcher.enabled=false",
    "researchhub.analysis.execution.dispatcher.enabled=false"})
@ActiveProfiles("local") @Import(PostgresTestcontainersConfiguration.class)
class CloudSessionCookieIntegrationTest {
    @Value("${local.server.port}") int port;
    @Autowired UserRegistrationService users;
    @Test void actualServletCookiesCarrySecureHttpOnlyAndConfiguredSameSite() throws Exception {
        users.register(new RegisterUserCommand("cloud-cookie@example.com", "correct-horse-battery-staple", "Cloud researcher"));
        var client = HttpClient.newHttpClient();
        var probe = client.send(HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/api/auth/csrf")).GET().build(), HttpResponse.BodyHandlers.ofString());
        String csrf = probe.headers().firstValue("Set-Cookie").orElseThrow();
        assertTrue(csrf.contains("Secure") && csrf.contains("SameSite=None"), csrf);
        assertFalse(csrf.contains("HttpOnly"), "CSRF is readable and is not a credential");
        String token = csrf.substring(csrf.indexOf('=') + 1, csrf.indexOf(';'));
        var login = client.send(HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/api/auth/login"))
            .header("Content-Type", "application/json").header("Cookie", "XSRF-TOKEN=" + token).header("X-XSRF-TOKEN", token)
            .POST(HttpRequest.BodyPublishers.ofString("{\"email\":\"cloud-cookie@example.com\",\"password\":\"correct-horse-battery-staple\"}")).build(), HttpResponse.BodyHandlers.ofString());
        assertEquals(200, login.statusCode(), login.body());
        String session = login.headers().allValues("Set-Cookie").stream().filter(value -> value.startsWith("JSESSIONID=")).findFirst().orElseThrow();
        assertTrue(session.contains("Secure") && session.contains("HttpOnly") && session.contains("SameSite=None"), session);
        assertTrue(login.headers().firstValue("Strict-Transport-Security").isEmpty(), "The cloud policy must not emit HSTS on a plain HTTP request");
    }
}
