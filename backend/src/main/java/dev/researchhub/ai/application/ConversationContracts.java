package dev.researchhub.ai.application;

import java.time.Instant;
import java.util.*;

/** Only application-visible inputs, complete outputs and safe telemetry cross the history boundary. */
public final class ConversationContracts {
    private ConversationContracts() {}
    public record Create(String title) {
        public Create {
            title = title == null ? "Research conversation" : title.strip();
            GenerationContracts.text(title,160);
        }
    }
    public record Send(UUID clientRequestId, String question, List<UUID> selectedSourceIds) {
        public Send {
            GenerationContracts.require(clientRequestId != null);
            selectedSourceIds = new QuestionContracts.Question(question,selectedSourceIds).selectedSourceIds();
        }
        public QuestionContracts.Question asQuestion() { return new QuestionContracts.Question(question,selectedSourceIds); }
    }
    public record Conversation(UUID id, UUID workspaceId, UUID createdBy, String title, Instant createdAt, Instant updatedAt) {}
    public record ConversationPage(List<Conversation> items, Integer nextOffset) {
        public ConversationPage { items = List.copyOf(items); }
    }
    public record Message(UUID id, UUID clientRequestId, long sequence, String role, String status, UUID authorId,
                          String content, List<UUID> selectedSourceIds, QuestionContracts.Response response,
                          String errorCode, Instant createdAt, Instant completedAt) {}
    public record History(Conversation conversation, List<Message> messages, Long nextBeforeSequence) {
        public History { messages = List.copyOf(messages); }
    }
    public record Completion(Message user, Message assistant) {}
    /** Internal lease identity prevents a cancelled/expired attempt from overwriting a later retry. */
    public record Claim(UUID attemptId, Message user, Message completedAssistant) {}
}
