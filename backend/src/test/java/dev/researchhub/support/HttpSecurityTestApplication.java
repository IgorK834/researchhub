package dev.researchhub.support;

import dev.researchhub.auth.infrastructure.SecurityConfiguration;
import dev.researchhub.auth.infrastructure.ProblemDetailAuthenticationEntryPoint;
import dev.researchhub.auth.infrastructure.ProblemDetailAccessDeniedHandler;
import dev.researchhub.auth.infrastructure.ProblemDetailErrorWriter;
import dev.researchhub.security.infrastructure.BrowserSecurityConfiguration;
import dev.researchhub.shared.observability.MetricsSecurityConfiguration;
import dev.researchhub.shared.observability.RequestCorrelationFilter;
import org.springframework.boot.autoconfigure.EnableAutoConfiguration;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Import;

/** Explicit infrastructure slice: HTTP/actuator/security without scanning the product or persistence graph. */
@org.springframework.boot.test.context.TestComponent
@Configuration(proxyBeanMethods = false)
@EnableAutoConfiguration
@Import({SecurityConfiguration.class, BrowserSecurityConfiguration.class,
        ProblemDetailAuthenticationEntryPoint.class, ProblemDetailAccessDeniedHandler.class, ProblemDetailErrorWriter.class,
        MetricsSecurityConfiguration.class, RequestCorrelationFilter.class})
public class HttpSecurityTestApplication {}
