package dev.researchhub.analysis.application;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
public class ProblemExecutionDispatcher {
    private final ProblemService service;
    private final boolean enabled;

    public ProblemExecutionDispatcher(
            ProblemService service,
            @Value("${researchhub.analysis.execution.dispatcher.enabled:true}") boolean enabled) {
        this.service = service;
        this.enabled = enabled;
    }

    @Scheduled(fixedDelayString = "${researchhub.analysis.execution.dispatcher.fixed-delay:PT1S}")
    public void dispatch() {
        if (enabled) service.dispatch();
    }
}
