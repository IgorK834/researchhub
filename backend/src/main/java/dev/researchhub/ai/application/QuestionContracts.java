package dev.researchhub.ai.application;

import java.util.*;
import dev.researchhub.ai.application.GenerationContracts.*;

/** Workspace comes from the authorized route, never from model output or a second body field. */
public final class QuestionContracts {
    private QuestionContracts() {}
    public record Question(String question, List<UUID> selectedSourceIds) {
        public Question {
            GenerationContracts.require(question != null && !question.isBlank() && question.length() <= 2000);
            // null/omitted = all authorized sources; [] = deliberately select none.
            if (selectedSourceIds != null) {
                selectedSourceIds = GenerationContracts.bounded(selectedSourceIds, 100);
                GenerationContracts.require(new HashSet<>(selectedSourceIds).size() == selectedSourceIds.size());
            }
        }
    }
    /** citations contains only cited retrieved chunks; generation retains the immutable context audit. */
    public record Response(String status, String reason, String answer, List<Citation> citations,
                           GeneratedResponse generation) {
        public Response {
            GenerationContracts.require(Set.of("SUPPORTED", "INSUFFICIENT_EVIDENCE").contains(status));
            GenerationContracts.text(answer, 25000);
            citations = GenerationContracts.bounded(citations, 12);
            GenerationContracts.require("SUPPORTED".equals(status)
                ? reason == null && !citations.isEmpty() && generation != null
                : citations.isEmpty() && Set.of("NO_RETRIEVED_EVIDENCE", "INSUFFICIENT_RETRIEVED_EVIDENCE").contains(reason));
        }
    }
}
