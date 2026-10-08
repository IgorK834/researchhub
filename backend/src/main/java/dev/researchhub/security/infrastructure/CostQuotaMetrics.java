package dev.researchhub.security.infrastructure;

import dev.researchhub.security.application.CostCategory;
import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;
import java.util.EnumMap;
import java.util.Map;

final class CostQuotaMetrics {
    private final Map<CostCategory, Counter> rejections = new EnumMap<>(CostCategory.class);

    CostQuotaMetrics(MeterRegistry registry) {
        for (CostCategory category : CostCategory.values()) {
            rejections.put(category, Counter.builder("researchhub.security.quotas.rejections")
                    .description("Costly requests rejected before admission")
                    .tag("category", category.name()).register(registry));
        }
    }

    void rejected(CostCategory category) {
        rejections.get(category).increment();
    }
}
