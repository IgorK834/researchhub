package dev.researchhub.processing.infrastructure;

import dev.researchhub.processing.domain.ProcessingJob;
import org.springframework.boot.context.properties.ConfigurationProperties;

import java.net.URI;
import java.time.Duration;

/** Local dispatcher and worker transport policy. */
@ConfigurationProperties("researchhub.processing")
public class ProcessingProperties {

    private final Dispatcher dispatcher = new Dispatcher();
    private final Worker worker = new Worker();

    public Dispatcher getDispatcher() {
        return dispatcher;
    }

    public Worker getWorker() {
        return worker;
    }

    public static class Dispatcher {
        private boolean enabled = true;
        private Duration fixedDelay = Duration.ofSeconds(1);
        private int batchSize = 4;
        private int maxAttempts = 5;
        private Duration initialBackoff = Duration.ofSeconds(2);
        private Duration maxBackoff = Duration.ofMinutes(1);
        private Duration staleTimeout = Duration.ofMinutes(5);

        public boolean isEnabled() {
            return enabled;
        }

        public void setEnabled(boolean enabled) {
            this.enabled = enabled;
        }

        public Duration getFixedDelay() {
            return fixedDelay;
        }

        public void setFixedDelay(Duration fixedDelay) {
            this.fixedDelay = positive(fixedDelay, "fixed delay");
        }

        public int getBatchSize() {
            return batchSize;
        }

        public void setBatchSize(int batchSize) {
            if (batchSize < 1 || batchSize > 100) {
                throw new IllegalArgumentException("processing batch size must be between 1 and 100");
            }
            this.batchSize = batchSize;
        }

        public int getMaxAttempts() {
            return maxAttempts;
        }

        public void setMaxAttempts(int maxAttempts) {
            if (maxAttempts < 1 || maxAttempts > ProcessingJob.ATTEMPT_COUNT_CEILING) {
                throw new IllegalArgumentException("processing max attempts must be between 1 and 100");
            }
            this.maxAttempts = maxAttempts;
        }

        public Duration getInitialBackoff() {
            return initialBackoff;
        }

        public void setInitialBackoff(Duration initialBackoff) {
            this.initialBackoff = positive(initialBackoff, "initial backoff");
        }

        public Duration getMaxBackoff() {
            return maxBackoff;
        }

        public void setMaxBackoff(Duration maxBackoff) {
            this.maxBackoff = positive(maxBackoff, "maximum backoff");
        }

        public Duration getStaleTimeout() {
            return staleTimeout;
        }

        public void setStaleTimeout(Duration staleTimeout) {
            this.staleTimeout = positive(staleTimeout, "stale timeout");
        }
    }

    public static class Worker {
        private URI baseUrl = URI.create("http://127.0.0.1:8090");
        private Duration requestTimeout = Duration.ofSeconds(30);
        private Duration sourceAccessTtl = Duration.ofMinutes(5);
        private String serviceToken;

        public URI getBaseUrl() {
            return baseUrl;
        }

        public void setBaseUrl(URI baseUrl) {
            if (baseUrl == null || !baseUrl.isAbsolute()
                    || !("http".equals(baseUrl.getScheme()) || "https".equals(baseUrl.getScheme()))) {
                throw new IllegalArgumentException("processing worker base URL must be an absolute HTTP(S) URL");
            }
            this.baseUrl = baseUrl;
        }

        public Duration getRequestTimeout() {
            return requestTimeout;
        }

        public void setRequestTimeout(Duration requestTimeout) {
            this.requestTimeout = positive(requestTimeout, "worker request timeout");
        }

        public Duration getSourceAccessTtl() {
            return sourceAccessTtl;
        }

        public void setSourceAccessTtl(Duration sourceAccessTtl) {
            Duration checked = positive(sourceAccessTtl, "worker source access TTL");
            if (checked.compareTo(Duration.ofMinutes(15)) > 0) {
                throw new IllegalArgumentException("processing worker source access TTL must be at most 15 minutes");
            }
            this.sourceAccessTtl = checked;
        }

        public String getServiceToken() {
            if (serviceToken == null) {
                throw new IllegalStateException("processing worker service token is required");
            }
            return serviceToken;
        }

        public void setServiceToken(String serviceToken) {
            if (serviceToken == null || serviceToken.length() < 32 || !serviceToken.equals(serviceToken.strip())) {
                throw new IllegalArgumentException(
                        "processing worker service token must contain at least 32 non-whitespace characters");
            }
            this.serviceToken = serviceToken;
        }
    }

    private static Duration positive(Duration value, String name) {
        if (value == null || value.isZero() || value.isNegative()) {
            throw new IllegalArgumentException("processing " + name + " must be positive");
        }
        return value;
    }
}
