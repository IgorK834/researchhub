package dev.researchhub.ai.application;

import java.util.UUID;
import dev.researchhub.ai.application.ConversationContracts.*;
import dev.researchhub.shared.error.ApiErrorCode;

public interface ConversationStore {
    Conversation create(UUID workspaceId, UUID callerId, String title);
    ConversationPage list(UUID workspaceId, int offset, int limit);
    Conversation find(UUID workspaceId, UUID conversationId);
    History history(UUID workspaceId, UUID conversationId, Long beforeSequence, int limit);
    Claim claim(UUID workspaceId, UUID conversationId, UUID callerId, Send send);
    Completion complete(UUID workspaceId, UUID conversationId, Claim claim, QuestionContracts.Response response) throws java.util.concurrent.CancellationException;
    void fail(UUID workspaceId, UUID conversationId, Claim claim, ApiErrorCode code, boolean abandoned);
}
