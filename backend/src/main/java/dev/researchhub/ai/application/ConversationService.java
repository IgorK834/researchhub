package dev.researchhub.ai.application;

import dev.researchhub.ai.application.ConversationContracts.*;
import dev.researchhub.shared.error.*;
import dev.researchhub.source.application.SourceReadScope;
import dev.researchhub.workspace.application.WorkspaceAuthorizationService;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Service;
import java.util.UUID;
import java.util.concurrent.CancellationException;

@Service
@Profile("local")
public class ConversationService {
    private final ConversationStore store;
    private final WorkspaceAuthorizationService authorization;
    private final SourceReadScope sources;
    private final WorkspaceQuestionService questions;
    public ConversationService(ConversationStore store, WorkspaceAuthorizationService authorization,
                               SourceReadScope sources, WorkspaceQuestionService questions) {
        this.store=store; this.authorization=authorization; this.sources=sources; this.questions=questions;
    }
    public Conversation create(UUID workspaceId, UUID callerId, Create command) {
        authorize(workspaceId,callerId);
        return store.create(workspaceId,callerId,command.title());
    }
    public ConversationPage list(UUID workspaceId, UUID callerId, int offset, int limit) {
        authorize(workspaceId,callerId);
        if (offset < 0 || offset > 100000 || limit < 1 || limit > 50) throw limits();
        var page=store.list(workspaceId,offset,limit);
        authorize(workspaceId,callerId);
        return page;
    }
    public History history(UUID workspaceId, UUID callerId, UUID conversationId, Long beforeSequence, int limit) {
        authorize(workspaceId,callerId);
        if (limit < 1 || limit > 25 || beforeSequence != null && beforeSequence < 1) throw limits();
        var history=store.history(workspaceId,conversationId,beforeSequence,limit);
        authorize(workspaceId,callerId);
        return history;
    }
    public void requireSend(UUID workspaceId, UUID callerId, UUID conversationId, Send send) {
        authorize(workspaceId,callerId);
        store.find(workspaceId,conversationId);
        if (send.selectedSourceIds() != null) sources.requireSources(workspaceId,callerId,send.selectedSourceIds());
    }
    public Completion send(UUID workspaceId, UUID callerId, UUID conversationId, Send send, QuestionExecution execution) {
        requireSend(workspaceId,callerId,conversationId,send);
        execution.checkpoint();
        var claim=store.claim(workspaceId,conversationId,callerId,send);
        try {
            execution.started(claim.user());
            execution.checkpoint();
            if (claim.completedAssistant() != null) {
                authorize(workspaceId,callerId);
                return new Completion(claim.user(),claim.completedAssistant());
            }
            var response=questions.answer(workspaceId,callerId,send.asQuestion(),execution);
            execution.checkpoint();
            authorize(workspaceId,callerId);
            return store.complete(workspaceId,conversationId,claim,response);
        } catch (CancellationException cancelled) {
            store.fail(workspaceId,conversationId,claim,ApiErrorCode.CONFLICT,true);
            throw cancelled;
        } catch (ApiException safe) {
            checkCancellation(workspaceId,conversationId,claim,execution);
            store.fail(workspaceId,conversationId,claim,safe.code(),false);
            throw safe;
        } catch (RuntimeException unsafe) {
            checkCancellation(workspaceId,conversationId,claim,execution);
            store.fail(workspaceId,conversationId,claim,ApiErrorCode.INTERNAL_ERROR,false);
            throw new ApiException(ApiErrorCode.INTERNAL_ERROR,"The research question could not be completed");
        }
    }
    public void authorize(UUID workspaceId, UUID callerId) { authorization.requireContentReader(workspaceId,callerId); }
    private void checkCancellation(UUID workspaceId,UUID conversationId,Claim claim,QuestionExecution execution) {
        try { execution.checkpoint(); }
        catch (CancellationException cancelled) { store.fail(workspaceId,conversationId,claim,ApiErrorCode.CONFLICT,true); throw cancelled; }
    }
    private static ApiException limits() { return new ApiException(ApiErrorCode.VALIDATION_FAILED,"Invalid conversation pagination limits"); }
}
