import io.micrometer.core.instrument.Metrics;
import java.util.concurrent.TimeUnit;

/** Synthetic emitter for the pinned agent contract; never opens the product database or Azure. */
public class MetricProbe {
    public static void main(String[] args) throws Exception {
        Metrics.counter("researchhub.ai.provider.unavailable");
        Metrics.counter("researchhub.worker.failures", "queue", "SOURCE_INGEST");
        Metrics.counter("researchhub.worker.failures", "queue", "ANALYSIS_EXECUTION");
        Metrics.gauge("hikaricp.connections.active", 1);
        Metrics.gauge("hikaricp.connections.max", 6);
        Metrics.gauge("researchhub.jobs.queue", java.util.List.of(
            io.micrometer.core.instrument.Tag.of("queue", "SOURCE_INGEST"),
            io.micrometer.core.instrument.Tag.of("status", "FAILED")), 0, Integer::doubleValue);
        Metrics.timer("researchhub.ai.request.duration").record(123, TimeUnit.MILLISECONDS);
        Thread.sleep(18000);
    }
}
