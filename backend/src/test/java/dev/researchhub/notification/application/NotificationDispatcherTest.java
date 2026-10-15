package dev.researchhub.notification.application;

import dev.researchhub.notification.infrastructure.PostgresNotifications;
import org.junit.jupiter.api.Test;
import org.springframework.transaction.*;
import java.time.*;
import java.util.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;

class NotificationDispatcherTest {
    @Test void eachTickIsBoundedAndRetriesOnlyAClaimedTransaction() {
        var store=mock(PostgresNotifications.class);var manager=mock(PlatformTransactionManager.class);
        when(manager.getTransaction(any())).thenAnswer(invocation->mock(TransactionStatus.class));
        var job=new PostgresNotifications.Delivery(UUID.randomUUID(),UUID.randomUUID());when(store.next(any())).thenReturn(job);
        var dispatcher=new NotificationDispatcher(store,manager,Clock.systemUTC(),true);dispatcher.scheduledDispatch();verify(store,times(50)).deliver(eq(job),any(),any());
        reset(store);when(store.next(any())).thenThrow(new IllegalStateException());dispatcher.dispatchAvailable();verify(store,never()).retry(any(),any());
        reset(store);when(store.next(any())).thenReturn(null);dispatcher.dispatchAvailable();verify(store,never()).deliver(any(),any(),any());
        dispatcher.scheduledCleanup();verify(store).cleanup(any());
        reset(store);var disabled=new NotificationDispatcher(store,manager,Clock.systemUTC(),false);
        disabled.scheduledDispatch();disabled.scheduledCleanup();verifyNoInteractions(store);
    }
    @org.junit.jupiter.api.Test void digestSchedulingUsesExistingEnableSwitch() {
        var digests=org.mockito.Mockito.mock(DigestService.class);
        var enabled=new NotificationDispatcher(org.mockito.Mockito.mock(dev.researchhub.notification.infrastructure.PostgresNotifications.class),org.mockito.Mockito.mock(org.springframework.transaction.PlatformTransactionManager.class),java.time.Clock.systemUTC(),true);
        org.springframework.test.util.ReflectionTestUtils.setField(enabled,"digests",digests);enabled.scheduledDigests();org.mockito.Mockito.verify(digests).dispatch();
        var disabled=new NotificationDispatcher(org.mockito.Mockito.mock(dev.researchhub.notification.infrastructure.PostgresNotifications.class),org.mockito.Mockito.mock(org.springframework.transaction.PlatformTransactionManager.class),java.time.Clock.systemUTC(),false);disabled.scheduledDigests();
    }

}
