package dev.researchhub.security.infrastructure;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import java.util.List;

@Configuration(proxyBeanMethods = false)
public class BrowserSecurityConfiguration {
    @Bean
    BrowserSecurityPolicy browserSecurityPolicy(
            @Value("${researchhub.environment:cloud}") String environment,
            @Value("${researchhub.auth.cors.allowed-origins:}") List<String> origins,
            @Value("${server.servlet.session.cookie.secure:true}") boolean secure,
            @Value("${server.servlet.session.cookie.same-site:lax}") String sameSite,
            @Value("${server.servlet.session.cookie.http-only:true}") boolean httpOnly) {
        return new BrowserSecurityPolicy(environment, origins, secure, sameSite, httpOnly);
    }
}
