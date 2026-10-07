package dev.researchhub.shared.observability;

import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.MultiGauge;
import io.micrometer.core.instrument.Tags;
import org.springframework.scheduling.annotation.Scheduled;
import java.util.List;
import java.util.Map;
import java.util.function.Supplier;

/** One aggregate read per refresh, independent of scrape frequency; a missing status exports zero. */
public class QueueMetrics {
    private final MultiGauge gauge;
    private final String queue;
    private final List<String> statuses;
    private final Supplier<Map<String, Long>> counts;

    public QueueMetrics(MeterRegistry registry, String queue, List<String> statuses,
                        Supplier<Map<String, Long>> counts) {
        gauge = MultiGauge.builder("researchhub.jobs.queue").register(registry);
        this.queue = queue;
        this.statuses = List.copyOf(statuses);
        this.counts = counts;
        refresh();
    }

    @Scheduled(fixedDelayString = "${researchhub.observability.queue-refresh:PT5S}")
    public void refresh() {
        Map<String, Long> snapshot = counts.get();
        gauge.register(statuses.stream().map(status -> MultiGauge.Row.of(
            Tags.of("queue", queue, "status", status), snapshot.getOrDefault(status, 0L))).toList(), true);
    }
}
