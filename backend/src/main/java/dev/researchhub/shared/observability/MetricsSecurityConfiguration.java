package dev.researchhub.shared.observability;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.annotation.Order;
import org.springframework.http.HttpStatus;
import org.springframework.security.authorization.AuthorizationDecision;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.HttpStatusEntryPoint;

/** Scrape credentials are separate from browser sessions. Empty configuration disables access. */
@Configuration(proxyBeanMethods = false)
@ConditionalOnWebApplication(type = ConditionalOnWebApplication.Type.SERVLET)
public class MetricsSecurityConfiguration {
    @Bean @Order(1)
    SecurityFilterChain metricsSecurity(HttpSecurity http,
            @Value("${researchhub.observability.scrape-token:}") String token) throws Exception {
        return http.securityMatcher("/actuator/prometheus")
            .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
            .csrf(c -> c.disable())
            .authorizeHttpRequests(a -> a.anyRequest().access((authentication, context) -> {
                String supplied = context.getRequest().getHeader("Authorization");
                boolean valid = "GET".equals(context.getRequest().getMethod()) && token.length() >= 32
                    && supplied != null && MessageDigest.isEqual(("Bearer " + token).getBytes(StandardCharsets.UTF_8),
                        supplied.getBytes(StandardCharsets.UTF_8));
                return new AuthorizationDecision(valid);
            }))
            .exceptionHandling(e -> e.authenticationEntryPoint(new HttpStatusEntryPoint(HttpStatus.UNAUTHORIZED))
                .accessDeniedHandler((request, response, failure) -> response.setStatus(401)))
            .requestCache(c -> c.disable()).build();
    }
}
