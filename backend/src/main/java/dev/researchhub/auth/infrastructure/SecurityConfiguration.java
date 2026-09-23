package dev.researchhub.auth.infrastructure;

import dev.researchhub.user.application.PasswordPolicy;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.context.HttpSessionSecurityContextRepository;
import org.springframework.security.web.context.SecurityContextRepository;
import org.springframework.security.web.csrf.CookieCsrfTokenRepository;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;

import java.time.Duration;
import java.util.List;

/**
 * Spring Security setup, implementing docs/adr/ADR-001-authentication.md.
 *
 * <p>Nothing here depends on the database. Authentication is performed by
 * {@code dev.researchhub.auth.api.AuthController} calling {@code user.application}, rather than by a
 * {@code UserDetailsService} or {@code DaoAuthenticationProvider} wired into the filter chain. That
 * matters for a concrete reason: JPA and the user repository exist only on the {@code local} profile, so
 * a chain that needed them would fail to start on {@code test} and {@code cloud}, where
 * {@code BackendApplicationTests} and {@code CloudProfileStartupTests} load the context.
 */
@Configuration
public class SecurityConfiguration {

    /**
     * Where the authenticated principal is kept: the HTTP session, keyed by the session cookie.
     *
     * <p>Exposed as a bean so {@link BrowserSession} saves the context through the same repository the
     * filter chain reads it from. A plain object, so it is available in non-web contexts too.
     */
    @Bean
    SecurityContextRepository securityContextRepository() {
        return new HttpSessionSecurityContextRepository();
    }

    /**
     * BCrypt, as fixed by ADR-001. Changing the algorithm is an ADR decision rather than a configuration
     * tweak, because every existing hash would have to be migrated.
     *
     * <p>Handed to {@code user.application} as Spring Security's {@link PasswordEncoder} interface, so
     * the {@code user} module hashes passwords without depending on {@code auth}.
     */
    @Bean
    PasswordEncoder passwordEncoder() {
        return new BCryptPasswordEncoder();
    }

    /**
     * Password rules. Declared here because {@code auth} owns the {@code researchhub.auth.*}
     * configuration, while the type itself lives in {@code user.application} so that both the
     * registration service and this module's request validator may use it.
     */
    @Bean
    PasswordPolicy passwordPolicy(@Value("${researchhub.auth.password.min-length:12}") int minLength) {
        return new PasswordPolicy(minLength);
    }

    /**
     * The filter chain, which exists only in a servlet application.
     *
     * <p>{@code HttpSecurity} comes from Spring Boot's servlet security auto-configuration and is absent
     * from a non-web context. Several persistence tests run with
     * {@code @SpringBootTest(webEnvironment = NONE)} on the {@code local} profile; without this
     * condition their context would fail to start because this bean could not be satisfied. The beans
     * above are plain objects and stay available everywhere, because {@code user.application} needs the
     * encoder and the policy whether or not HTTP is being served.
     */
    @Configuration
    @ConditionalOnWebApplication(type = ConditionalOnWebApplication.Type.SERVLET)
    static class ServletSecurityConfiguration {

        /** Public health probes. Documented as unauthenticated in docs/development/health.md. */
        private static final String[] PUBLIC_HEALTH_PATHS = {
                "/actuator/health", "/actuator/health/liveness", "/actuator/health/readiness"
        };

        /**
         * Cross-origin rules for the browser client.
         *
         * <p>The webpack dev server proxies {@code /api} and {@code /actuator} to this application, so
         * the normal development path is same-origin and never reaches CORS at all. This policy covers
         * the case where the SPA on {@code http://localhost:3000} calls the API origin directly, and it
         * exists as an explicit statement rather than an accident of whichever default applies.
         *
         * <p>Origins are listed exactly. {@code *} is rejected outright below: combined with
         * {@code allowCredentials} it would let any site on the internet make authenticated requests with
         * the user's session cookie and read the replies. Browsers refuse that pairing, and failing at
         * startup is clearer than failing on the first preflight.
         *
         * <p>{@code X-XSRF-TOKEN} has to be allowed or CSRF-protected requests could not be sent
         * cross-origin at all: the browser would block the header before the request left.
         */
        @Bean
        CorsConfigurationSource corsConfigurationSource(
                @Value("${researchhub.auth.cors.allowed-origins:http://localhost:3000}")
                List<String> allowedOrigins) {
            if (allowedOrigins.contains("*")) {
                throw new IllegalStateException(
                        "researchhub.auth.cors.allowed-origins must not be '*': a wildcard origin cannot "
                                + "be combined with credentialed requests. List each allowed origin.");
            }

            CorsConfiguration configuration = new CorsConfiguration();
            configuration.setAllowedOrigins(allowedOrigins);
            configuration.setAllowedMethods(
                    List.of("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"));
            configuration.setAllowedHeaders(List.of("Content-Type", "Accept", "X-XSRF-TOKEN"));
            // Without this the browser would strip the session and CSRF cookies from a cross-origin call.
            configuration.setAllowCredentials(true);
            configuration.setMaxAge(Duration.ofMinutes(30));

            UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
            source.registerCorsConfiguration("/api/**", configuration);
            // The status banner reads health, so it needs the same treatment.
            source.registerCorsConfiguration("/actuator/health/**", configuration);
            source.registerCorsConfiguration("/actuator/health", configuration);
            return source;
        }

        @Bean
        SecurityFilterChain securityFilterChain(HttpSecurity http,
                                                ProblemDetailAuthenticationEntryPoint entryPoint,
                                                ProblemDetailAccessDeniedHandler accessDeniedHandler,
                                                SecurityContextRepository securityContextRepository,
                                                CorsConfigurationSource corsConfigurationSource)
                throws Exception {
            http
                    .cors(cors -> cors.configurationSource(corsConfigurationSource))

                    .authorizeHttpRequests(requests -> requests
                            .requestMatchers(PUBLIC_HEALTH_PATHS).permitAll()
                            // Reaching these is how a caller becomes authenticated, so they cannot
                            // themselves require authentication.
                            .requestMatchers(HttpMethod.POST, "/api/auth/register", "/api/auth/login")
                            .permitAll()
                            .requestMatchers(HttpMethod.GET, "/api/auth/csrf").permitAll()
                            // Everything else is closed by default: the identity reads, logout, and
                            // every future product route. A new endpoint is private until someone opens
                            // it here on purpose.
                            //
                            // Logout is deliberately authenticated. It needs a session to invalidate, so
                            // an anonymous POST has nothing to do and gets 401 rather than a silent 204
                            // that would confirm the route exists.
                            .anyRequest().authenticated())

                    // Cookies ride along automatically, so a mutating request must prove it came from
                    // our own page. The CSRF cookie is readable by JavaScript because the SPA has to
                    // echo it back; it is not a credential, and the session cookie stays HttpOnly.
                    .csrf(csrf -> csrf
                            .csrfTokenRepository(CookieCsrfTokenRepository.withHttpOnlyFalse())
                            .csrfTokenRequestHandler(new SpaCsrfTokenRequestHandler()))

                    .securityContext(context -> context
                            .securityContextRepository(securityContextRepository))

                    // Without these, a 401 would arrive as Spring Security's own JSON or as an HTML
                    // redirect to a generated login page, giving clients a second error contract.
                    .exceptionHandling(exceptions -> exceptions
                            .authenticationEntryPoint(entryPoint)
                            .accessDeniedHandler(accessDeniedHandler))

                    // This is a JSON API. The generated login page and the browser's basic-auth dialog
                    // are not part of the contract, and either would be a second way in that the ADR
                    // does not describe. Logout is not implemented in this pass.
                    .formLogin(form -> form.disable())
                    .httpBasic(basic -> basic.disable())
                    .logout(logout -> logout.disable())

                    // Nothing should be replayed after a 401, and an unauthenticated caller is simply
                    // unauthenticated rather than an "anonymous" principal.
                    .requestCache(cache -> cache.disable())
                    .anonymous(anonymous -> anonymous.disable());

            return http.build();
        }

    }

}
