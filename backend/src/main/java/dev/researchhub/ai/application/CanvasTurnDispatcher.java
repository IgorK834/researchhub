package dev.researchhub.ai.application;
import org.springframework.stereotype.Component;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.beans.factory.annotation.Value;
@Component
public class CanvasTurnDispatcher {
    private final CanvasTurnStore store;private final CanvasConversationService service;private final boolean enabled;
    public CanvasTurnDispatcher(CanvasTurnStore store,CanvasConversationService service,@Value("${researchhub.ai.canvas.dispatcher.enabled:true}") boolean enabled) {this.store=store;this.service=service;this.enabled=enabled;}
    @Scheduled(fixedDelayString="${researchhub.ai.canvas.dispatcher.fixed-delay:PT1S}") public void scheduledDispatch() {if(enabled)dispatchAvailable();}
    public void dispatchAvailable() {store.claim().ifPresent(service::execute);}
}
