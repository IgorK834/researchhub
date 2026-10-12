package dev.researchhub.ai.observability;

import dev.researchhub.ai.application.CanvasConversationContracts.Work;
import dev.researchhub.ai.application.CanvasProposalContracts.Operation;
import dev.researchhub.audit.application.ProductAudit;
import dev.researchhub.audit.application.ProductAudit.CanvasStage;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import org.junit.jupiter.api.Test;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import java.util.UUID;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class CanvasWorkflowObservationTest {
    final UUID w=UUID.randomUUID(),u=UUID.randomUUID(),d=UUID.randomUUID(),t=UUID.randomUUID();
    final Work work=new Work(w,u,UUID.randomUUID(),d,t,UUID.randomUUID(),null,null);
    final Operation op=new Operation(t,w,d,u,UUID.randomUUID(),"ACCEPT",null,null,null,null);
    @Test void observesSuccessFailureAndClosedLabelsWithIdsOnlyInAudit() {
        var metrics=new SimpleMeterRegistry();var audit=mock(ProductAudit.class);var observation=new CanvasWorkflowObservation(metrics,audit);
        assertEquals("result",observation.measure(work,CanvasStage.MODEL,()->"result"));
        assertThrows(IllegalStateException.class,()->observation.measure(work,CanvasStage.MODEL,()->{throw new IllegalStateException("private prompt");}));
        observation.record(work,CanvasStage.QUEUE,12,true);
        assertEquals(3,metrics.getMeters().size());
        metrics.getMeters().forEach(m->{assertEquals(2,m.getId().getTags().size());assertFalse(m.getId().toString().contains(t.toString()));});
        verify(audit).canvasStage(eq(w),eq(u),eq(d),eq(t),eq(CanvasStage.QUEUE),eq(12L),eq(true));
        assertEquals(1,metrics.find("researchhub.canvas.stage.duration").tags("stage","MODEL","outcome","failure").timer().count());
    }
    @Test void auditFailureDoesNotChangeOutcomeAndNoneStillRunsAction() {
        var audit=mock(ProductAudit.class);doThrow(new IllegalStateException("unavailable")).when(audit).canvasStage(any(),any(),any(),any(),any(),anyLong(),anyBoolean());
        assertEquals(5,new CanvasWorkflowObservation(null,audit).measure(work,CanvasStage.ROUTING,()->5));
        assertEquals(6,CanvasWorkflowObservation.none().measure(work,CanvasStage.RETRIEVAL,()->6));
        CanvasWorkflowObservation.none().inserted(op,3);
        assertTrue(CanvasWorkflowObservation.elapsed(System.nanoTime())>=0);
    }
    @Test void insertionIsAuditedOnlyAfterCommitAndImmediateOutsideTransaction() {
        var audit=mock(ProductAudit.class);var observation=new CanvasWorkflowObservation(new SimpleMeterRegistry(),audit);
        TransactionSynchronizationManager.initSynchronization();
        try {observation.inserted(op,20);verifyNoInteractions(audit);TransactionSynchronizationManager.getSynchronizations().forEach(s->s.afterCommit());}
        finally {TransactionSynchronizationManager.clearSynchronization();}
        verify(audit).canvasStage(w,u,d,t,CanvasStage.INSERTION,20,true);
        observation.inserted(op,21);verify(audit).canvasStage(w,u,d,t,CanvasStage.INSERTION,21,true);
    }
}
