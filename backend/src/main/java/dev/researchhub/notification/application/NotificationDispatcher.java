package dev.researchhub.notification.application;

import dev.researchhub.notification.infrastructure.PostgresNotifications;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import java.time.Clock;

@Component
public class NotificationDispatcher {
    private final PostgresNotifications store;
    private final TransactionTemplate transactions;
    private final Clock clock;
    private final boolean enabled;
    public NotificationDispatcher(PostgresNotifications store,PlatformTransactionManager manager,Clock clock,
        @Value("${researchhub.notifications.dispatcher.enabled:true}") boolean enabled) {
        this.store=store;this.transactions=new TransactionTemplate(manager);this.clock=clock;this.enabled=enabled;
    }
    @Scheduled(fixedDelayString="${researchhub.notifications.dispatcher.delay:PT5S}")
    public void scheduledDispatch() {if(enabled)dispatchAvailable();}
    public void dispatchAvailable() {
        for(int i=0;i<50;i++) {
            var claimed=new java.util.concurrent.atomic.AtomicReference<PostgresNotifications.Delivery>();
            try {
                boolean found=Boolean.TRUE.equals(transactions.execute(status->{
                    var job=store.next(clock.instant());if(job==null)return false;
                    claimed.set(job);store.deliver(job,clock.instant(),clock.instant().minus(NotificationService.RETENTION));return true;
                }));
                if(!found)return;
            } catch(RuntimeException failure) {
                if(claimed.get()!=null)transactions.executeWithoutResult(status->store.retry(claimed.get(),clock.instant()));
                org.slf4j.LoggerFactory.getLogger(getClass()).warn("Notification projection retry scheduled: {}",failure.getClass().getSimpleName());
                return;
            }
        }
    }
    @Scheduled(fixedDelayString="${researchhub.notifications.cleanup.delay:PT1H}")
    public void scheduledCleanup() {if(enabled)cleanup();}
    public void cleanup() {transactions.executeWithoutResult(status->store.cleanup(clock.instant().minus(NotificationService.RETENTION)));}
}
