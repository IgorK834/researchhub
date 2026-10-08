package dev.researchhub.analysis.infrastructure;

import dev.researchhub.analysis.application.AnalysisPlanner;
import dev.researchhub.analysis.application.AnalysisContracts.*;
import dev.researchhub.ai.application.ModelFailure;
import dev.researchhub.shared.error.ApiErrorCode;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.*;
import tools.jackson.databind.*;
import java.net.URI;
import java.net.http.HttpClient;
import java.time.Duration;
import java.util.Set;

/** Analysis owns its worker port/adapter; the literature/authoring AI module does not depend on computation. */
@Component
public class HttpAnalysisPlanner implements AnalysisPlanner {
    @org.springframework.beans.factory.annotation.Autowired
    private dev.researchhub.shared.observability.WorkMetrics metrics =
        new dev.researchhub.shared.observability.WorkMetrics(io.micrometer.core.instrument.Metrics.globalRegistry);
    private final RestClient client;
    private final String token;
    private final ObjectMapper json;
    public HttpAnalysisPlanner(ObjectMapper json,
        @Value("${researchhub.processing.worker.base-url}") URI baseUrl,
        @Value("${researchhub.processing.worker.service-token}") String token,
        @Value("${researchhub.processing.worker.request-timeout:PT30S}") Duration timeout) {
        if (baseUrl==null || baseUrl.getHost()==null || baseUrl.getUserInfo()!=null || baseUrl.getQuery()!=null || baseUrl.getFragment()!=null
            || !("http".equals(baseUrl.getScheme()) || "https".equals(baseUrl.getScheme()))
            || token==null || token.length()<32 || !token.equals(token.strip()) || timeout==null || timeout.isZero() || timeout.isNegative())
            throw new IllegalArgumentException("Invalid planning worker connection");
        var factory=new JdkClientHttpRequestFactory(HttpClient.newBuilder().connectTimeout(timeout).followRedirects(HttpClient.Redirect.NEVER).build());
        factory.setReadTimeout(timeout);
        this.client=RestClient.builder().baseUrl(baseUrl.toString()).requestFactory(factory).requestInterceptor(dev.researchhub.shared.observability.CorrelationContext.propagation()).build();this.token=token;
        this.json=json.rebuild().disable(MapperFeature.ALLOW_COERCION_OF_SCALARS).disable(DeserializationFeature.ACCEPT_FLOAT_AS_INT)
            .enable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES,DeserializationFeature.FAIL_ON_MISSING_CREATOR_PROPERTIES,
                DeserializationFeature.FAIL_ON_NULL_FOR_PRIMITIVES,DeserializationFeature.FAIL_ON_TRAILING_TOKENS).build();
    }
    @Override public Candidate plan(PlanningRequest request) {
        return metrics.ai(() -> planUnobserved(request));
    }
    private Candidate planUnobserved(PlanningRequest request) {
        try {
            return client.post().uri("/internal/analysis/plan").header("Authorization","Bearer "+token)
                .contentType(MediaType.APPLICATION_JSON).body(json.writeValueAsBytes(request)).exchange((_request,response) -> {
                    int status=response.getStatusCode().value();
                    if (status!=200) {
                        ApiErrorCode code=status==422 ? ApiErrorCode.AI_REFUSED : Set.of(408,429,503,504).contains(status) ? ApiErrorCode.AI_UNAVAILABLE : ApiErrorCode.AI_PROVIDER_ERROR;
                        dev.researchhub.ai.observability.AiDiagnostics.ProviderUsage telemetry=null;
                        try (var body=response.getBody()) {
                            byte[] bytes=body.readNBytes(4097);
                            if (bytes.length<=4096) {
                                var error=json.readTree(bytes);
                                if (status==502 && "AI_OUTPUT_INVALID".equals(error.path("code").asString())) code=ApiErrorCode.AI_OUTPUT_INVALID;
                                if (error.hasNonNull("telemetry")) telemetry=json.treeToValue(error.get("telemetry"),dev.researchhub.ai.observability.AiDiagnostics.ProviderUsage.class);
                            }
                        } catch (RuntimeException invalid) { /* Unsafe/invalid provider metadata is discarded. */ }
                        throw new ModelFailure(code,telemetry);
                    }
                    try (var body=response.getBody()) {
                        byte[] bytes=body.readNBytes(256*1024+1);
                        if (bytes.length>256*1024) throw new ModelFailure(ApiErrorCode.AI_OUTPUT_INVALID);
                        Candidate candidate=json.readValue(bytes,Candidate.class);
                        if (candidate==null) throw new ModelFailure(ApiErrorCode.AI_OUTPUT_INVALID);
                        return candidate;
                    } catch (tools.jackson.core.JacksonException invalid) { throw new ModelFailure(ApiErrorCode.AI_OUTPUT_INVALID); }
                });
        } catch (ModelFailure safe) { throw safe; }
        catch (ResourceAccessException unavailable) { throw new ModelFailure(ApiErrorCode.AI_UNAVAILABLE); }
        catch (RuntimeException unsafe) { throw new ModelFailure(ApiErrorCode.AI_PROVIDER_ERROR); }
    }
}
