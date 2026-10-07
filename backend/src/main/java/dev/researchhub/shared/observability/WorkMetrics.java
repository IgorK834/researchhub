package dev.researchhub.shared.observability;

import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Timer;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import java.util.function.Supplier;

/** Closed label sets prevent input, resource IDs or exception text becoming metric dimensions. */
@Component
public class WorkMetrics {
    public enum Operation {
        SOURCE("researchhub.source.processing.duration"),
        AI("researchhub.ai.request.duration"),
        ANALYSIS("researchhub.analysis.execution.duration");
        final String name;
        Operation(String name) { this.name = name; }
    }
    public enum Queue { SOURCE_INGEST, ANALYSIS_EXECUTION }
    public enum RetryReason { FAILURE, STALE }
    private final MeterRegistry registry;
    public WorkMetrics(MeterRegistry registry) { this.registry = registry; }

    public Timer.Sample start() { return Timer.start(registry); }
    public void finish(Timer.Sample sample, Operation operation, boolean success) {
        sample.stop(Timer.builder(operation.name).tag("outcome", success ? "success" : "failure")
            .publishPercentileHistogram().register(registry));
    }
    public <T> T ai(Supplier<T> call) {
        var sample = start();
        boolean success = false;
        try { T result = call.get(); success = true; return result; }
        finally {
            finish(sample, Operation.AI, success);
            LoggerFactory.getLogger(getClass()).atInfo().addKeyValue("event", "ai.request.completed")
                .addKeyValue("outcome", success ? "success" : "failure").log("AI request completed");
        }
    }
    public void failure(Queue queue) {
        registry.counter("researchhub.worker.failures", "queue", queue.name()).increment();
    }
    public void retry(Queue queue, RetryReason reason) {
        registry.counter("researchhub.worker.retries", "queue", queue.name(), "reason", reason.name()).increment();
    }
}
