package dev.researchhub.user.infrastructure;

import dev.researchhub.user.application.AccountErasureService;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
@ConditionalOnProperty(name="researchhub.account.erasure.dispatcher.enabled",havingValue="true",matchIfMissing=true)
public class AccountErasureDispatcher {
    private final AccountErasureService service;
    public AccountErasureDispatcher(AccountErasureService service) {this.service=service;}
    @Scheduled(fixedDelayString="${researchhub.account.erasure.dispatcher.delay:PT5S}")
    public void dispatch() {
        try { service.processNext(); }
        catch(RuntimeException failure) { org.slf4j.LoggerFactory.getLogger(getClass()).warn("event=account.erasure.retry reason=database_reconciliation_pending"); }
    }
}
