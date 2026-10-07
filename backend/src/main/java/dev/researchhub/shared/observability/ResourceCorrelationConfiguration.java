package dev.researchhub.shared.observability;

import org.slf4j.MDC;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.HandlerInterceptor;
import org.springframework.web.servlet.HandlerMapping;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;
import java.util.Map;
import java.util.List;

/** Only validated UUID route variables enter MDC. The enclosing request scope restores it. */
@Configuration(proxyBeanMethods = false)
public class ResourceCorrelationConfiguration implements WebMvcConfigurer {
    @Override public void addInterceptors(InterceptorRegistry registry) {
        registry.addInterceptor(new HandlerInterceptor() {
            @Override public boolean preHandle(jakarta.servlet.http.HttpServletRequest request,
                    jakarta.servlet.http.HttpServletResponse response, Object handler) {
                Object attribute = request.getAttribute(HandlerMapping.URI_TEMPLATE_VARIABLES_ATTRIBUTE);
                if (attribute instanceof Map<?, ?> variables) {
                    for (String key : List.of("sourceId", "analysisId")) {
                        Object value = variables.get(key);
                        if (value instanceof String id && id.matches("[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"))
                            MDC.put(key, id);
                    }
                }
                return true;
            }
        });
    }
}
