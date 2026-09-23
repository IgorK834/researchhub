package dev.researchhub.auth.infrastructure;

import dev.researchhub.user.application.PasswordPolicy;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.context.HttpSessionSecurityContextRepository;
import org.springframework.security.web.context.SecurityContextRepository;
import org.springframework.security.web.csrf.CookieCsrfTokenRepository;

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

        @Bean
        SecurityFilterChain securityFilterChain(HttpSecurity http,
                                                ProblemDetailAuthenticationEntryPoint entryPoint,
                                                ProblemDetailAccessDeniedHandler accessDeniedHandler,
                                                SecurityContextRepository securityContextRepository)
                throws Exception {
            http
                    .authorizeHttpRequests(requests -> requests
                            .requestMatchers(PUBLIC_HEALTH_PATHS).permitAll()
                            // Reaching these is how a caller becomes authenticated, so they cannot
                            // themselves require authentication.
                            .requestMatchers("/api/auth/register", "/api/auth/login", "/api/auth/csrf")
                            .permitAll()
                            // Everything else, including /api/auth/me and every future product route, is
                            // closed by default. A new endpoint is private until someone opens it here
                            // on purpose.
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
