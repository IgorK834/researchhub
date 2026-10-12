package dev.researchhub.ai.application;

import org.springframework.stereotype.Component;

/** Closed application routes. Provider output can never name a Java service, tool or resource. */
@Component
public class CanvasIntentRouter {
    public sealed interface Route permits Answer, Edit, Dataset, Problem, Clarify {}

    public record Answer() implements Route {}

    public record Edit() implements Route {}

    public record Dataset() implements Route {}

    public record Problem() implements Route {}

    public record Clarify(String message) implements Route {}

    public Route route(CanvasConversationContracts.Intent intent, String clarification) {
        if (clarification != null) return new Clarify(clarification);
        return switch (intent) {
            case ANSWER, CLARIFY -> new Answer();
            case EDIT -> new Edit();
            case ANALYZE -> new Dataset();
            case SOLVE -> new Problem();
        };
    }
}
