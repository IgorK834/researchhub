package dev.researchhub.ai.application;
import org.junit.jupiter.api.Test;
import static org.mockito.Mockito.*;
import java.util.Optional;
class CanvasTurnDispatcherTest {
    @Test void schedulesOnlyEnabledWorkersAndExecutesOnlyClaimedDurableWork() {
        var store=mock(CanvasTurnStore.class);var service=mock(CanvasConversationService.class);
        new CanvasTurnDispatcher(store,service,false).scheduledDispatch();verifyNoInteractions(store,service);
        when(store.claim()).thenReturn(Optional.empty());new CanvasTurnDispatcher(store,service,true).scheduledDispatch();verify(store).claim();verifyNoInteractions(service);
        var work=mock(CanvasConversationContracts.Work.class);when(store.claim()).thenReturn(Optional.of(work));
        new CanvasTurnDispatcher(store,service,true).dispatchAvailable();verify(service).execute(work);
    }
}
