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
    public record Send(UUID clientRequestId, String question, List<UUID> selectedSourceIds,
        List<dev.researchhub.analysis.application.AnalysisEvidenceService.Reference> selectedAnalysisOutputs) {
        public Send {
            GenerationContracts.require(clientRequestId != null);
            var command=new QuestionContracts.Question(question,selectedSourceIds,selectedAnalysisOutputs);
            selectedSourceIds=command.selectedSourceIds();selectedAnalysisOutputs=command.selectedAnalysisOutputs();
        }
        public Send(UUID clientRequestId,String question,List<UUID> selectedSourceIds) { this(clientRequestId,question,selectedSourceIds,List.of()); }
        public QuestionContracts.Question asQuestion() { return new QuestionContracts.Question(question,selectedSourceIds,selectedAnalysisOutputs); }
    }
    public record Conversation(UUID id, UUID workspaceId, UUID createdBy, String title, Instant createdAt, Instant updatedAt,
        @com.fasterxml.jackson.annotation.JsonInclude(com.fasterxml.jackson.annotation.JsonInclude.Include.NON_NULL)
        CanvasConversationContracts.Origin origin) {
        public Conversation(UUID id, UUID workspaceId, UUID createdBy, String title, Instant createdAt, Instant updatedAt) {
            this(id,workspaceId,createdBy,title,createdAt,updatedAt,null);
        }
    }
    public record ConversationPage(List<Conversation> items, Integer nextOffset) {
        public ConversationPage { items = List.copyOf(items); }
    }
    public record Message(UUID id, UUID clientRequestId, long sequence, String role, String status, UUID authorId,
                          String content, List<UUID> selectedSourceIds, QuestionContracts.Response response,
                          String errorCode, Instant createdAt, Instant completedAt,
                          @com.fasterxml.jackson.annotation.JsonInclude(com.fasterxml.jackson.annotation.JsonInclude.Include.NON_EMPTY)
                          List<dev.researchhub.analysis.application.AnalysisEvidenceService.Reference> selectedAnalysisOutputs) {
        public Message { selectedAnalysisOutputs=selectedAnalysisOutputs==null ? List.of() : List.copyOf(selectedAnalysisOutputs); }
        public Message(UUID id,UUID clientRequestId,long sequence,String role,String status,UUID authorId,String content,List<UUID> selectedSourceIds,QuestionContracts.Response response,
            String errorCode,Instant createdAt,Instant completedAt) { this(id,clientRequestId,sequence,role,status,authorId,content,selectedSourceIds,response,errorCode,createdAt,completedAt,List.of()); }
    }
    public record History(Conversation conversation, List<Message> messages, Long nextBeforeSequence,
        @com.fasterxml.jackson.annotation.JsonInclude(com.fasterxml.jackson.annotation.JsonInclude.Include.NON_EMPTY)
        List<CanvasConversationContracts.TurnState> turns) {
        public History(Conversation conversation,List<Message> messages,Long nextBeforeSequence) { this(conversation,messages,nextBeforeSequence,List.of()); }
        public History { messages = List.copyOf(messages); turns=turns==null?List.of():List.copyOf(turns); }
    }
    public record Completion(Message user, Message assistant) {}
    /** Internal lease identity prevents a cancelled/expired attempt from overwriting a later retry. */
    public record Claim(UUID attemptId, Message user, Message completedAssistant) {}
}
