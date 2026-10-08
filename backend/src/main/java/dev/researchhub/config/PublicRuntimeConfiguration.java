package dev.researchhub.config;

import dev.researchhub.ai.application.ModelProvider;
import dev.researchhub.user.application.RegistrationPolicy;
import dev.researchhub.shared.error.ApiErrorCode;
import dev.researchhub.shared.error.ApiException;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;

/** Explicit public allowlist. AI identity comes from the same provider that executes requests. */
@RestController
public class PublicRuntimeConfiguration {
    public record Ai(String mode, String modelName) {}
    public record Facts(String environment, boolean demo, String registrationMode, Ai ai) {}
    private final String environment;
    private final RegistrationPolicy registration;
    private final ModelProvider models;
    private final Clock clock;
    private Facts cached;
    private Instant expires = Instant.MIN;

    public PublicRuntimeConfiguration(@Value("${researchhub.environment}") String environment,
                                      RegistrationPolicy registration, ModelProvider models, Clock clock) {
        this.environment = environment;
        this.registration = registration;
        this.models = models;
        this.clock = clock;
    }

    @GetMapping("/api/public/config")
    public synchronized ResponseEntity<Facts> config() {
        if (!clock.instant().isBefore(expires)) {
            var metadata = models.modelMetadata();
            boolean fixture = "deterministic".equals(metadata.provider());
            // An internal address is never a public model label.
            String name = metadata.name();
            if (!fixture && (!name.matches("[A-Za-z0-9][A-Za-z0-9._/ -]{0,127}") || name.contains("//"))) {
                throw new ApiException(ApiErrorCode.AI_OUTPUT_INVALID, "The model identity is unavailable");
            }
            cached = new Facts(environment, "demo".equals(environment), registration.mode().value(),
                    new Ai(fixture ? "deterministic" : "live", fixture ? null : name));
            expires = clock.instant().plusSeconds(60);
        }
        return ResponseEntity.ok().cacheControl(CacheControl.maxAge(Duration.ofSeconds(60)).cachePublic()).body(cached);
    }
}
