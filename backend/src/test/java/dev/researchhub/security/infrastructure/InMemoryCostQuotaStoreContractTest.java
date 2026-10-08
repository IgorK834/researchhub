package dev.researchhub.security.infrastructure;

import dev.researchhub.security.application.CostQuotaStore;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import java.time.Clock;

class InMemoryCostQuotaStoreContractTest extends CostQuotaStoreContract {
    @Override protected CostQuotaStore createStore(Clock clock, SimpleMeterRegistry metrics) {
        return new InMemoryCostQuotaStore(clock, 1000, metrics);
    }
}
