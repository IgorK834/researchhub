package dev.researchhub.processing.infrastructure;

import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Profile;
import org.springframework.scheduling.annotation.EnableScheduling;

/** Enables the local database dispatcher without introducing a broker. */
@Configuration
@Profile("local")
@EnableScheduling
@EnableConfigurationProperties(ProcessingProperties.class)
public class ProcessingConfiguration {
    @org.springframework.context.annotation.Bean
    dev.researchhub.shared.observability.QueueMetrics sourceQueueMetrics(
            io.micrometer.core.instrument.MeterRegistry registry, org.springframework.jdbc.core.JdbcTemplate jdbc) {
        return new dev.researchhub.shared.observability.QueueMetrics(registry, "SOURCE_INGEST",
            java.util.Arrays.stream(dev.researchhub.processing.domain.ProcessingJobStatus.values()).map(Enum::name).toList(),
            () -> jdbc.query("SELECT status,count(*) FROM processing_jobs GROUP BY status", result -> {
                var counts = new java.util.HashMap<String, Long>();
                while (result.next()) counts.put(result.getString(1), result.getLong(2));
                return counts;
            }));
    }
}
