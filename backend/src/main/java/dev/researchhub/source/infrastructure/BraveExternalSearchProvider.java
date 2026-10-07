package dev.researchhub.source.infrastructure;

import dev.researchhub.source.application.ExternalSearchProvider;
import dev.researchhub.source.application.ExternalSourceService;
import dev.researchhub.source.application.ExternalSourceContracts.Result;
import dev.researchhub.shared.error.ApiErrorCode;
import dev.researchhub.shared.error.ApiException;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Component;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.web.client.RestClient;
import org.springframework.web.util.HtmlUtils;
import tools.jackson.databind.ObjectMapper;
import java.net.URI;
import java.net.http.HttpClient;
import java.time.Duration;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;

/** Fixed provider destination, bounded response, no redirects, no following discovered URLs. */
@Component
@Profile("local")
public class BraveExternalSearchProvider implements ExternalSearchProvider {
    private final boolean enabled;
    private final String key;
    private final ObjectMapper json;
    private final RestClient client;
    private final HttpClient transport;
    @Autowired
    public BraveExternalSearchProvider(ObjectMapper json,
            @Value("${researchhub.sources.external-search.enabled:false}") boolean enabled,
            @Value("${researchhub.sources.external-search.api-key:}") String key,
            @Value("${researchhub.sources.external-search.timeout:PT8S}") Duration timeout) {
        this(json, enabled, key, timeout, URI.create("https://api.search.brave.com"));
    }
    BraveExternalSearchProvider(ObjectMapper json, boolean enabled, String key, Duration timeout, URI endpoint) {
        if (timeout == null || timeout.isNegative() || timeout.isZero() || timeout.compareTo(Duration.ofSeconds(30)) > 0
                || (enabled && (key == null || key.isBlank() || !key.equals(key.strip()) || key.chars().anyMatch(Character::isISOControl))))
            throw new IllegalArgumentException("Invalid external search configuration");
        this.enabled = enabled; this.key = key; this.json = json;
        transport = HttpClient.newBuilder().connectTimeout(timeout).followRedirects(HttpClient.Redirect.NEVER).build();
        var factory = new JdkClientHttpRequestFactory(transport);
        factory.setReadTimeout(timeout);
        client = RestClient.builder().baseUrl(endpoint.toString()).requestFactory(factory).build();
    }
    public boolean available() { return enabled; }
    public String name() { return "BRAVE"; }
    @jakarta.annotation.PreDestroy
    public void close() { transport.close(); }
    public List<Result> search(String query) {
        if (!enabled) throw new ApiException(ApiErrorCode.EXTERNAL_SEARCH_UNAVAILABLE, "External search is not configured on this server");
        try {
            return client.get().uri(builder -> builder.path("/res/v1/web/search").queryParam("q", query)
                    .queryParam("count", 10).queryParam("text_decorations", false).queryParam("spellcheck", false).build())
                .header("X-Subscription-Token", key).header("Accept", "application/json")
                .exchange((request, response) -> {
                    if (!response.getStatusCode().is2xxSuccessful()) throw new IllegalArgumentException("Provider search failed");
                    try (var body = response.getBody()) {
                        byte[] bytes = body.readNBytes(512 * 1024 + 1);
                        if (bytes.length > 512 * 1024) throw new IllegalArgumentException("Provider response too large");
                        var root = json.readTree(bytes);
                        if (!root.isObject()) throw new IllegalArgumentException("Invalid provider response");
                        var web = root.get("web");
                        if (web == null) return List.<Result>of();
                        var results = web.get("results");
                        if (results == null || !results.isArray() || results.size() > 20) throw new IllegalArgumentException("Invalid provider results");
                        var accepted = new ArrayList<Result>();
                        var urls = new HashSet<String>();
                        for (var hit : results) {
                            try {
                                var result = ExternalSourceService.validatedResult(text(hit.get("title")), text(hit.get("url")),
                                        hit.has("description") ? text(hit.get("description")) : "");
                                if (urls.add(result.url())) accepted.add(result);
                            } catch (IllegalArgumentException unsafeResult) { /* An unsafe link never reaches the product. */ }
                            if (accepted.size() == 10) break;
                        }
                        return List.copyOf(accepted);
                    }
                });
        } catch (RuntimeException failure) {
            // Never expose provider error bodies, credentials or request URLs in product errors.
            throw new ApiException(ApiErrorCode.EXTERNAL_SEARCH_FAILED, "External search could not be completed. Try again later");
        }
    }
    private static String text(tools.jackson.databind.JsonNode value) {
        if (value == null || !value.isString()) throw new IllegalArgumentException("Expected provider text");
        return HtmlUtils.htmlUnescape(value.asString().replaceAll("<[^>]*>", ""));
    }
}
