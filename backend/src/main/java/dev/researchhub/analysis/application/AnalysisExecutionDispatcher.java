package dev.researchhub.analysis.application;

import java.time.Clock;
import java.time.Duration;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/** Module-local durable queue: independent processes cannot claim the same execution. */
@Component
public class AnalysisExecutionDispatcher {
    private final ExecutionStore store;
    private final ExecutionService service;
    private final Clock clock;
    private final boolean enabled;
    public AnalysisExecutionDispatcher(ExecutionStore store,ExecutionService service,Clock clock,
        @Value("${researchhub.analysis.execution.dispatcher.enabled:true}") boolean enabled) {
        this.store=store; this.service=service; this.clock=clock; this.enabled=enabled;
    }
    @Scheduled(fixedDelayString="${researchhub.analysis.execution.dispatcher.fixed-delay:PT1S}")
    public void scheduledDispatch() { if (enabled) dispatchAvailable(); }
    public void dispatchAvailable() {
        store.recoverInterrupted(clock.instant().minus(Duration.ofMinutes(10)),clock.instant());
        store.claim(clock.instant()).ifPresent(service::execute);
    }
}
