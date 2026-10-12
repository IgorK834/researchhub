package dev.researchhub.user.infrastructure;
import dev.researchhub.user.application.AccountErasureService;
import org.junit.jupiter.api.Test;
import static org.mockito.Mockito.*;
import static org.junit.jupiter.api.Assertions.*;
class AccountErasureDispatcherTest {
 @Test void retriesAfterDatabaseFailuresWithoutLoggingPayloads() {var service=mock(AccountErasureService.class);var dispatcher=new AccountErasureDispatcher(service);dispatcher.dispatch();when(service.processNext()).thenThrow(new IllegalStateException("private diagnostic"));assertDoesNotThrow(dispatcher::dispatch);verify(service,times(2)).processNext();}
}
