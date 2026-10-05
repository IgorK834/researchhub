package dev.researchhub.ai.application;

import java.util.*;
import dev.researchhub.ai.application.GenerationContracts.*;

/** Workspace comes from the authorized route, never from model output or a second body field. */
public final class QuestionContracts {
    private QuestionContracts() {}
    public record Question(String question, List<UUID> selectedSourceIds,
        List<dev.researchhub.analysis.application.AnalysisEvidenceService.Reference> selectedAnalysisOutputs) {
        public Question {
            GenerationContracts.require(question != null && !question.isBlank() && question.length() <= 2000);
            // null/omitted = all authorized sources; [] = deliberately select none.
            if (selectedSourceIds != null) {
                selectedSourceIds = GenerationContracts.bounded(selectedSourceIds, 100);
                GenerationContracts.require(new HashSet<>(selectedSourceIds).size() == selectedSourceIds.size());
            }
            selectedAnalysisOutputs=GenerationContracts.bounded(selectedAnalysisOutputs==null ? List.of() : selectedAnalysisOutputs,6);
            GenerationContracts.require(new HashSet<>(selectedAnalysisOutputs).size()==selectedAnalysisOutputs.size());
        }
        public Question(String question,List<UUID> selectedSourceIds) { this(question,selectedSourceIds,List.of()); }
    }
    /** citations contains only cited retrieved chunks; generation retains the immutable context audit. */
    public record Response(String status, String reason, String answer, List<Citation> citations,
                           GeneratedResponse generation,
                           @com.fasterxml.jackson.annotation.JsonInclude(com.fasterxml.jackson.annotation.JsonInclude.Include.NON_EMPTY)
                           List<dev.researchhub.analysis.application.AnalysisEvidenceService.Citation> analysisCitations) {
        public Response {
            GenerationContracts.require(Set.of("SUPPORTED", "INSUFFICIENT_EVIDENCE").contains(status));
            GenerationContracts.text(answer, 25000);
            citations = GenerationContracts.bounded(citations, 12);
            analysisCitations=GenerationContracts.bounded(analysisCitations==null ? List.of() : analysisCitations,6);
            GenerationContracts.require("SUPPORTED".equals(status)
                ? reason == null && (!citations.isEmpty() || !analysisCitations.isEmpty()) && generation != null
                : citations.isEmpty() && analysisCitations.isEmpty() && Set.of("NO_RETRIEVED_EVIDENCE", "INSUFFICIENT_RETRIEVED_EVIDENCE").contains(reason));
        }
        public Response(String status,String reason,String answer,List<Citation> citations,GeneratedResponse generation) { this(status,reason,answer,citations,generation,List.of()); }
    }
}
