package dev.researchhub.ai.api;

import dev.researchhub.ai.application.*;
import dev.researchhub.ai.application.ConversationContracts.*;
import dev.researchhub.shared.error.*;
import jakarta.annotation.PreDestroy;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Component;
import org.springframework.http.MediaType;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;
import java.io.IOException;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;

/** One-way research events; validated answer deltas follow complete persistence, never raw model tokens. */
@Component
@Profile("local")
public class ConversationStreams {
    private final ConversationService conversations;
    private final ConversationStreamProperties properties;
    private final Semaphore slots;
    private final ExecutorService workers=Executors.newVirtualThreadPerTaskExecutor();
    private final ScheduledExecutorService timers=Executors.newScheduledThreadPool(2,Thread.ofPlatform().daemon().name("ai-sse-heartbeat-",0).factory());
    public ConversationStreams(ConversationService conversations,ConversationStreamProperties properties) {
        this.conversations=conversations; this.properties=properties; this.slots=new Semaphore(properties.maxConcurrent());
    }
    public SseEmitter open(UUID workspaceId,UUID callerId,UUID conversationId,Send command) {
        conversations.requireSend(workspaceId,callerId,conversationId,command);
        if (!slots.tryAcquire()) throw new ModelFailure(ApiErrorCode.AI_UNAVAILABLE);
        var state=new Stream(workspaceId,callerId,conversationId,command);
        state.emitter.onCompletion(() -> { if (!state.terminal.get()) state.cancel(); });
        state.emitter.onError(error -> state.cancel());
        state.emitter.onTimeout(() -> state.error(ApiErrorCode.AI_UNAVAILABLE,"The research stream timed out",true));
        state.heartbeat=timers.scheduleAtFixedRate(state::heartbeat,properties.heartbeat().toMillis(),properties.heartbeat().toMillis(),TimeUnit.MILLISECONDS);
        // Send the terminal event while the servlet connection is still writable.
        // A servlet timeout callback runs after Spring has disabled emitter writes.
        state.deadline=timers.schedule(() -> state.error(ApiErrorCode.AI_UNAVAILABLE,"The research stream timed out",true),properties.timeout().toMillis(),TimeUnit.MILLISECONDS);
        String requestId=dev.researchhub.shared.observability.CorrelationContext.currentOrNew();
        state.task=workers.submit(() -> {
            try (var ignored=dev.researchhub.shared.observability.CorrelationContext.open(requestId)) { state.run(); }
        });
        if (state.cancelled.get()) state.task.cancel(false);
        return state.emitter;
    }
    private final class Stream implements QuestionExecution {
        private final UUID workspaceId,callerId,conversationId;
        private final Send command;
        private final SseEmitter emitter=new SseEmitter(properties.timeout().toMillis()+1000);
        private final AtomicBoolean cancelled=new AtomicBoolean(),terminal=new AtomicBoolean(),released=new AtomicBoolean(),taskStarted=new AtomicBoolean();
        private final AtomicInteger eventNumber=new AtomicInteger();
        private volatile Future<?> task;
        private volatile ScheduledFuture<?> heartbeat;
        private volatile ScheduledFuture<?> deadline;
        private Stream(UUID workspaceId,UUID callerId,UUID conversationId,Send command) {
            this.workspaceId=workspaceId; this.callerId=callerId; this.conversationId=conversationId; this.command=command;
        }
        @Override public void checkpoint() {
            if (cancelled.get() || Thread.currentThread().isInterrupted()) throw new CancellationException("Research stream was disconnected");
        }
        @Override public void started(Message user) { send("started",Map.of("conversationId",conversationId,"user",user)); }
        @Override public void retrievalCompleted(int count) {
            conversations.authorize(workspaceId,callerId);
            send("retrieval_completed",Map.of("chunkCount",count));
        }
        private void run() {
            taskStarted.set(true);
            try {
                checkpoint();
                var completion=conversations.send(workspaceId,callerId,conversationId,command,this);
                String answer=completion.assistant().content();
                // Only complete, validated, persisted text is exposed. Keep Unicode code points intact.
                for (int start=0; start<answer.length();) {
                    checkpoint(); conversations.authorize(workspaceId,callerId);
                    int remaining=answer.codePointCount(start,answer.length());
                    int end=answer.offsetByCodePoints(start,Math.min(remaining,240));
                    send("delta",Map.of("text",answer.substring(start,end))); start=end;
                }
                conversations.authorize(workspaceId,callerId);
                completed(completion);
            } catch (CancellationException disconnected) { cancel(); }
            catch (ApiException safe) { error(safe.code(),safe.getMessage(),safe.code()==ApiErrorCode.AI_UNAVAILABLE); }
            catch (RuntimeException unsafe) { error(ApiErrorCode.INTERNAL_ERROR,"The research stream could not be completed",false); }
            finally { terminal.set(true); stopHeartbeat(); release(); emitter.complete(); }
        }
        private synchronized void completed(Completion completion) {
            send("completed",completion);
            terminal.set(true);
        }
        private synchronized void send(String name,Object data) {
            checkpoint();
            if (terminal.get() && !"error".equals(name)) throw new CancellationException("Research stream has terminated");
            try { emitter.send(SseEmitter.event().id(Integer.toString(eventNumber.incrementAndGet())).name(name).data(data,MediaType.APPLICATION_JSON)); }
            catch (IOException | IllegalStateException disconnected) { cancel(); throw new CancellationException("Research stream was disconnected"); }
        }
        private void heartbeat() {
            if (terminal.get() || cancelled.get()) return;
            try {
                conversations.authorize(workspaceId,callerId);
                emitter.send(SseEmitter.event().comment("keepalive"));
            } catch (ApiException revoked) { error(revoked.code(),revoked.getMessage(),false); }
            catch (IOException | IllegalStateException disconnected) { cancel(); }
        }
        private synchronized void error(ApiErrorCode code,String detail,boolean retryable) {
            if (terminal.compareAndSet(false,true)) {
                if (!cancelled.get()) {
                    try { send("error",Map.of("code",code.name(),"detail",detail==null ? "The research request failed" : detail,"retryable",retryable)); }
                    catch (CancellationException disconnected) { /* no usable connection remains */ }
                }
                cancel(); emitter.complete();
            }
        }
        private void cancel() {
            cancelled.set(true); stopHeartbeat();
            // The current synchronous provider has no cancellation port. Let its bounded call finish,
            // then checkpoints abandon the result; never interrupt a history/audit transaction.
            var active=task; if (active != null) active.cancel(false);
            if (!taskStarted.get()) release();
        }
        private void stopHeartbeat() {
            var active=heartbeat; if (active != null) active.cancel(false);
            var limit=deadline; if (limit != null) limit.cancel(false);
        }
        private void release() { if (released.compareAndSet(false,true)) slots.release(); }
    }
    @PreDestroy public void close() { timers.shutdownNow(); workers.shutdownNow(); }
}
