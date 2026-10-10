package dev.researchhub.ai.application;

import java.util.*;
import dev.researchhub.analysis.application.AnalysisEvidenceService.Reference;
import dev.researchhub.shared.error.ApiErrorCode;
import static dev.researchhub.ai.application.GenerationContracts.*;

/** The reserved Canvas v1 turn contract; v2 history is an additive view of existing conversations. */
public final class CanvasConversationContracts {
    private CanvasConversationContracts() {}
    public enum Intent { ANSWER, EDIT, ANALYZE, SOLVE, CLARIFY }
    public record Scope(List<UUID> sourceVersionIds, List<Reference> analysisOutputs) {
        public Scope {
            sourceVersionIds=bounded(sourceVersionIds,12);analysisOutputs=bounded(analysisOutputs,6);
            require(new HashSet<>(sourceVersionIds).size()==sourceVersionIds.size());
            require(new HashSet<>(analysisOutputs).size()==analysisOutputs.size());
        }
    }
    public record Turn(String schemaVersion, UUID clientRequestId, UUID contextId, Intent intent,
            String instruction, UUID replyToMessageId, UUID targetProposalId, Scope scope) {
        public Turn { require("1.0".equals(schemaVersion) && clientRequestId!=null && contextId!=null && intent!=null && scope!=null);
            text(instruction,8000);require(instruction.length()<=8000); }
    }
    public record FirstTurn(String schemaVersion, UUID clientConversationId, UUID contextId, Turn turn) {
        public FirstTurn { require("1.0".equals(schemaVersion) && clientConversationId!=null && contextId!=null && turn!=null && contextId.equals(turn.contextId())); }
    }
    public record Origin(UUID documentId, UUID contextId, String documentTitle) {}
    public record MemoryEntry(UUID messageId, String classification, String content) {
        public MemoryEntry { require(messageId!=null && Set.of("USER_INPUT","MODEL_EXPLANATION").contains(classification));text(content,2000); }
    }
    public record Memory(String schemaVersion, UUID contextId, UUID documentId, String instruction,
            String selectedText, String before, String after, UUID targetProposalId, String proposalText,
            List<UUID> appliedBlockIds, List<MemoryEntry> history, int omittedMessages) {
        public Memory {
            require("1.0".equals(schemaVersion) && contextId!=null && documentId!=null && omittedMessages>=0);
            text(instruction,8000);require(selectedText!=null && selectedText.length()<=4000 && before!=null && before.length()<=512 && after!=null && after.length()<=512);
            require(proposalText==null || proposalText.length()<=4000);
            appliedBlockIds=bounded(appliedBlockIds,32);history=bounded(history,6);
        }
    }
    public record MemorySummary(String schemaVersion, int includedMessages, int omittedMessages, String memoryHash) {}
    public record TurnState(String schemaVersion, UUID turnId, UUID conversationId, String status,
            UUID messageId, UUID proposalId, UUID executionId, ApiErrorCode failureCode,
            UUID contextId, Intent intent, Scope scope, String resultKind, MemorySummary memory) {}
    public record Work(UUID workspaceId, UUID callerId, UUID conversationId, UUID documentId,
            UUID turnId, UUID leaseId, Turn request, ConversationContracts.Claim claim) {}
}
