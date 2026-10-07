package dev.researchhub.ai.infrastructure;

import dev.researchhub.ai.application.*;
import dev.researchhub.ai.application.GenerationContracts.*;
import dev.researchhub.shared.error.ApiErrorCode;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Component;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.web.client.*;
import tools.jackson.databind.*;
import java.net.URI;
import java.net.http.HttpClient;
import java.time.Duration;
import java.util.Set;

/** Internal service HTTP adapter. Only the Python provider adapter knows Foundry's protocol. */
@Component
@Profile("local")
public class HttpModelProvider implements ModelProvider, AuthoringModelProvider, SourceAnalysisModelProvider {
    @org.springframework.beans.factory.annotation.Autowired
    private dev.researchhub.shared.observability.WorkMetrics metrics =
        new dev.researchhub.shared.observability.WorkMetrics(io.micrometer.core.instrument.Metrics.globalRegistry);
    private final RestClient client;
    private final String token;
    private final ObjectMapper mapper;
    public HttpModelProvider(ObjectMapper mapper,
        @Value("${researchhub.processing.worker.base-url}") URI baseUrl,
        @Value("${researchhub.processing.worker.service-token}") String token,
        @Value("${researchhub.processing.worker.request-timeout:PT30S}") Duration timeout) {
        if (baseUrl == null || baseUrl.getHost() == null || baseUrl.getUserInfo() != null || baseUrl.getQuery() != null || baseUrl.getFragment() != null
            || !("http".equals(baseUrl.getScheme()) || "https".equals(baseUrl.getScheme()))
            || token == null || token.length() < 32 || !token.equals(token.strip())
            || timeout == null || timeout.isZero() || timeout.isNegative()) throw new IllegalArgumentException("Invalid model worker connection");
        var factory = new JdkClientHttpRequestFactory(HttpClient.newBuilder().connectTimeout(timeout).followRedirects(HttpClient.Redirect.NEVER).build());
        factory.setReadTimeout(timeout);
        this.client = RestClient.builder().baseUrl(baseUrl.toString()).requestFactory(factory).requestInterceptor(dev.researchhub.shared.observability.CorrelationContext.propagation()).build();
        this.token = token;
        this.mapper = mapper.rebuild().disable(MapperFeature.ALLOW_COERCION_OF_SCALARS)
            .disable(DeserializationFeature.ACCEPT_FLOAT_AS_INT)
            .enable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, DeserializationFeature.FAIL_ON_NULL_FOR_PRIMITIVES,
                DeserializationFeature.FAIL_ON_MISSING_CREATOR_PROPERTIES).build();
    }
    @Override public ModelMetadata modelMetadata() {
        return call(client.get().uri("/internal/ai/model").header("Authorization", "Bearer " + token), ModelMetadata.class);
    }
    @Override public AuthoringContracts.Result author(ContextContracts.ContextualRequest request) {
        return call(client.post().uri("/internal/ai/author").header("Authorization", "Bearer " + token)
            .contentType(org.springframework.http.MediaType.APPLICATION_JSON).body(mapper.writeValueAsBytes(request)), AuthoringContracts.Result.class);
    }
    @Override public SourceAnalysisContracts.Result analyze(ContextContracts.ContextualRequest request) {
        return call(client.post().uri("/internal/ai/analyze").header("Authorization", "Bearer " + token)
            .contentType(org.springframework.http.MediaType.APPLICATION_JSON).body(mapper.writeValueAsBytes(request)), SourceAnalysisContracts.Result.class);
    }
    @Override public Result generateStructured(Request request) {
        Result result = call(client.post().uri("/internal/ai/generate").header("Authorization", "Bearer " + token)
            .contentType(org.springframework.http.MediaType.APPLICATION_JSON).body(mapper.writeValueAsBytes(request)), Result.class);
        try { result.validateFor(request); return result; }
        catch (IllegalArgumentException invalid) { throw new ModelFailure(ApiErrorCode.AI_OUTPUT_INVALID, new dev.researchhub.ai.observability.AiDiagnostics.ProviderUsage(result.model(),result.usage())); }
    }
    @Override public Result generateStructured(ContextContracts.ContextualRequest request) {
        Result result = call(client.post().uri("/internal/ai/generate").header("Authorization", "Bearer " + token)
            .contentType(org.springframework.http.MediaType.APPLICATION_JSON).body(mapper.writeValueAsBytes(request)), Result.class);
        try { result.validateFor(request.request()); return result; }
        catch (IllegalArgumentException invalid) { throw new ModelFailure(ApiErrorCode.AI_OUTPUT_INVALID, new dev.researchhub.ai.observability.AiDiagnostics.ProviderUsage(result.model(),result.usage())); }
    }
    private dev.researchhub.ai.observability.AiDiagnostics.ProviderUsage usageMetadata(byte[] bytes) {
        try {
            var value=mapper.readTree(bytes);
            return new dev.researchhub.ai.observability.AiDiagnostics.ProviderUsage(mapper.treeToValue(value.get("model"),ModelMetadata.class),mapper.treeToValue(value.get("usage"),Usage.class));
        } catch (RuntimeException invalid) { return null; }
    }
    private <T> T call(RestClient.RequestHeadersSpec<?> request, Class<T> type) {
        return metrics.ai(() -> callUnobserved(request, type));
    }
    private <T> T callUnobserved(RestClient.RequestHeadersSpec<?> request, Class<T> type) {
        try {
            return request.exchange((_request, response) -> {
                int status = response.getStatusCode().value();
                if (status != 200) {
                    // Only an allowlisted code can cross the boundary; never retain/log provider details.
                    ApiErrorCode code = status==422 ? ApiErrorCode.AI_REFUSED
                        : Set.of(408,429,503,504).contains(status) ? ApiErrorCode.AI_UNAVAILABLE : ApiErrorCode.AI_PROVIDER_ERROR;
                    dev.researchhub.ai.observability.AiDiagnostics.ProviderUsage telemetry=null;
                    try (var body=response.getBody()) {
                        byte[] bytes=body.readNBytes(4097);
                        if (bytes.length<=4096) {
                            var error=mapper.readTree(bytes);
                            if (status==502 && "AI_OUTPUT_INVALID".equals(error.path("code").asString())) code=ApiErrorCode.AI_OUTPUT_INVALID;
                            if (error.hasNonNull("telemetry")) telemetry=mapper.treeToValue(error.get("telemetry"),dev.researchhub.ai.observability.AiDiagnostics.ProviderUsage.class);
                        }
                    } catch (RuntimeException invalid) { /* Invalid/unknown metadata stays unknown. */ }
                    throw new ModelFailure(code,telemetry);
                }
                try (var body = response.getBody()) {
                    byte[] bytes = body.readNBytes(256 * 1024 + 1);
                    if (bytes.length > 256 * 1024) throw new ModelFailure(ApiErrorCode.AI_OUTPUT_INVALID);
                    T value;
                    try { value=mapper.readValue(bytes,type); }
                    catch (tools.jackson.core.JacksonException invalid) { throw new ModelFailure(ApiErrorCode.AI_OUTPUT_INVALID, usageMetadata(bytes)); }
                    if (value == null) throw new ModelFailure(ApiErrorCode.AI_OUTPUT_INVALID);
                    return value;
                } catch (tools.jackson.core.JacksonException invalid) { throw new ModelFailure(ApiErrorCode.AI_OUTPUT_INVALID); }
            });
        } catch (ModelFailure safe) { throw safe; }
        catch (ResourceAccessException unavailable) { throw new ModelFailure(ApiErrorCode.AI_UNAVAILABLE); }
        catch (RuntimeException unsafe) { throw new ModelFailure(ApiErrorCode.AI_PROVIDER_ERROR); }
    }
}
