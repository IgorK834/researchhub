package dev.researchhub.analysis.infrastructure;

import dev.researchhub.shared.observability.QueueMetrics;
import dev.researchhub.analysis.application.ExecutionContracts.Status;
import io.micrometer.core.instrument.MeterRegistry;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Profile;
import org.springframework.jdbc.core.JdbcTemplate;
import java.util.Arrays;
import java.util.HashMap;

@Configuration(proxyBeanMethods = false)
@Profile("local")
public class AnalysisMetricsConfiguration {
    @Bean QueueMetrics analysisQueueMetrics(MeterRegistry registry, JdbcTemplate jdbc) {
        return new QueueMetrics(registry, "ANALYSIS_EXECUTION", Arrays.stream(Status.values()).map(Enum::name).toList(),
            () -> jdbc.query("SELECT status,count(*) FROM analysis_executions GROUP BY status", result -> {
                var counts = new HashMap<String, Long>();
                while (result.next()) counts.put(result.getString(1), result.getLong(2));
                return counts;
            }));
    }
}
