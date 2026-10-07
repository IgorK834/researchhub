package dev.researchhub.export.application;

import java.time.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Profile;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/** Dedicated scheduler keeps expensive rendering off HTTP threads and other modules' dispatchers. */
@Component
@Profile("local")
public class ExportDispatcher {
    private final ExportStore store;
    private final ExportService service;
    private final Clock clock;
    private final boolean enabled;
    public ExportDispatcher(ExportStore store,ExportService service,Clock clock,
                            @Value("${researchhub.export.dispatcher.enabled:true}") boolean enabled) {
        this.store=store;this.service=service;this.clock=clock;this.enabled=enabled;
    }
    @Scheduled(fixedDelayString="${researchhub.export.dispatcher.fixed-delay:PT1S}",scheduler="exportScheduler")
    public void scheduledDispatch() { if (enabled) dispatchAvailable(); }
    public void dispatchAvailable() {
        store.maintain(clock.instant().minus(Duration.ofMinutes(10)),clock.instant());
        store.claim(clock.instant()).ifPresent(service::execute);
    }
}
