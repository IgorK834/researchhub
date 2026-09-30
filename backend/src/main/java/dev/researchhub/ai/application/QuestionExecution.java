package dev.researchhub.ai.application;

/** Per-request event/cancellation boundary, independent of SSE and any future collaboration transport. */
public interface QuestionExecution {
    QuestionExecution NONE = new QuestionExecution() {};
    default void checkpoint() {}
    default void started(ConversationContracts.Message user) {}
    default void retrievalCompleted(int count) {}
}
