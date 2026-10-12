package dev.researchhub.ai.observability;

import dev.researchhub.ai.application.CanvasConversationContracts.Work;
import dev.researchhub.ai.application.CanvasProposalContracts.Operation;
import dev.researchhub.audit.application.ProductAudit;
import dev.researchhub.audit.application.ProductAudit.CanvasStage;
import io.micrometer.core.instrument.MeterRegistry;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.*;
import java.util.concurrent.TimeUnit;
import java.util.function.Supplier;

/** IDs are append-only audit metadata; labels are closed stage/outcome sets. No prompt/output data. */
@Component
public class CanvasWorkflowObservation {
    private final MeterRegistry metrics;private final ProductAudit audit;
    public CanvasWorkflowObservation(MeterRegistry metrics,ProductAudit audit) {this.metrics=metrics;this.audit=audit;}
    public static CanvasWorkflowObservation none() {return new CanvasWorkflowObservation(null,null);}
    public <T> T measure(Work work,CanvasStage stage,Supplier<T> action) {
        long start=System.nanoTime();boolean success=false;
        try {T result=action.get();success=true;return result;}
        finally {record(work,stage,elapsed(start),success);}
    }
    public static long elapsed(long nanos) {return Math.max(0,(System.nanoTime()-nanos)/1_000_000);}
    public void record(Work work,CanvasStage stage,long millis,boolean success) {
        record(work.workspaceId(),work.callerId(),work.documentId(),work.turnId(),stage,millis,success);
    }
    private void record(java.util.UUID workspace,java.util.UUID actor,java.util.UUID doc,java.util.UUID operation,CanvasStage stage,long millis,boolean success) {
        if(metrics!=null)metrics.timer("researchhub.canvas.stage.duration","stage",stage.name(),"outcome",success ? "success" : "failure").record(millis,TimeUnit.MILLISECONDS);
        if(audit!=null)try {audit.canvasStage(workspace,actor,doc,operation,stage,millis,success);}
        catch(RuntimeException unavailable) {org.slf4j.LoggerFactory.getLogger(getClass()).atWarn().addKeyValue("event","canvas.audit.unavailable").addKeyValue("stage",stage.name()).log("Canvas stage audit unavailable");}
    }
    public void inserted(Operation op,long millis) {
        Runnable save=()->record(op.workspaceId(),op.callerId(),op.documentId(),op.id(),CanvasStage.INSERTION,millis,true);
        if(TransactionSynchronizationManager.isSynchronizationActive())TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
            @Override public void afterCommit() {save.run();}
        });else save.run();
    }
}
