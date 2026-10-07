package dev.researchhub.ai.infrastructure;

import dev.researchhub.ai.application.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Component;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientResponseException;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.DeserializationFeature;
import java.net.http.HttpClient;
import java.net.URI;
import java.time.Duration;
import java.util.*;

/** Calls the internal Python provider boundary, using service credentials only. */
@Component
@Profile("local")
public class HttpEmbeddingProvider implements EmbeddingProvider {
    @org.springframework.beans.factory.annotation.Autowired
    private dev.researchhub.shared.observability.WorkMetrics metrics =
        new dev.researchhub.shared.observability.WorkMetrics(io.micrometer.core.instrument.Metrics.globalRegistry);
    private final RestClient client;
    private final String token;
    private final ObjectMapper mapper;
    public HttpEmbeddingProvider(ObjectMapper mapper,
        @Value("${researchhub.processing.worker.base-url}") URI baseUrl,
        @Value("${researchhub.processing.worker.service-token}") String token,
        @Value("${researchhub.processing.worker.request-timeout:PT30S}") Duration timeout) {
        if (baseUrl == null || baseUrl.getHost() == null || !("http".equals(baseUrl.getScheme()) || "https".equals(baseUrl.getScheme()))
                || token == null || token.length() < 32 || !token.equals(token.strip())
                || timeout == null || timeout.isZero() || timeout.isNegative()) throw new IllegalArgumentException("Invalid embedding worker connection");
        var factory = new JdkClientHttpRequestFactory(HttpClient.newBuilder().connectTimeout(timeout).build());
        factory.setReadTimeout(timeout);
        this.client = RestClient.builder().baseUrl(baseUrl.toString()).requestFactory(factory).requestInterceptor(dev.researchhub.shared.observability.CorrelationContext.propagation()).build();
        this.token = token;
        this.mapper = mapper;
    }
    @Override public EmbeddingModel modelMetadata() {
        try {
            return read(client.get().uri("/internal/embeddings/model").header("Authorization", "Bearer " + token), EmbeddingModel.class);
        } catch (RuntimeException error) { throw safe(error); }
    }
    @Override public EmbeddingBatch embedDocuments(List<String> texts) {
        if (texts == null || texts.size() > 10000) throw new IllegalArgumentException("Invalid embedding input");
        if (texts.isEmpty()) return new EmbeddingBatch(modelMetadata(), List.of());
        EmbeddingModel model = null;
        var vectors = new ArrayList<List<Double>>();
        for (int start = 0; start < texts.size(); start += 32) {
            var batch = call("documents", texts.subList(start, Math.min(start + 32, texts.size())));
            if (model != null && !model.equals(batch.metadata())) throw new IllegalArgumentException("Embedding model changed during batching");
            model = batch.metadata(); vectors.addAll(batch.vectors());
        }
        return new EmbeddingBatch(model, vectors);
    }
    @Override public EmbeddingBatch embedQuery(String text) { return call("query", List.of(text)); }
    private EmbeddingBatch call(String operation, List<String> texts) {
        if (texts.stream().anyMatch(t -> t == null || t.isBlank() || t.codePointCount(0,t.length()) > 8000))
            throw new IllegalArgumentException("Invalid embedding text");
        try {
            var result = read(client.post().uri("/internal/embeddings/" + operation).header("Authorization", "Bearer " + token)
                .contentType(org.springframework.http.MediaType.APPLICATION_JSON).body(mapper.writeValueAsBytes(Map.of("texts", texts))), EmbeddingBatch.class);
            result.requireCount(texts.size()); return result;
        } catch (RuntimeException error) { throw safe(error); }
    }
    private <T> T read(RestClient.RequestHeadersSpec<?> request, Class<T> type) {
        return metrics.ai(() -> request.exchange((_request, response) -> {
            if (!response.getStatusCode().is2xxSuccessful()) throw new org.springframework.web.client.HttpClientErrorException(response.getStatusCode());
            try (var body = response.getBody()) {
                byte[] bytes = body.readNBytes(4 * 1024 * 1024 + 1);
                if (bytes.length > 4 * 1024 * 1024) throw new IllegalArgumentException("Embedding response limit");
                return mapper.readerFor(type).with(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES).readValue(bytes);
            }
        }));
    }
    private static EmbeddingFailure safe(RuntimeException error) {
        boolean retryable = error instanceof org.springframework.web.client.ResourceAccessException
            || (error instanceof RestClientResponseException http && (http.getStatusCode().value() == 408
                || http.getStatusCode().value() == 429 || http.getStatusCode().is5xxServerError()));
        return new EmbeddingFailure(error, retryable);
    }
}
