package dev.researchhub.ai.application;

import java.time.Instant;
import java.util.*;
import static dev.researchhub.ai.application.GenerationContracts.*;

/** Versioned authoring boundary. Locations are ProseMirror UTF-16 positions in expectedRevision. */
public final class AuthoringContracts {
    private AuthoringContracts() {}
    public enum Kind { DRAFT, REWRITE, EVIDENCE }
    public enum Action { IMPROVE_ACADEMIC_STYLE, SHORTEN, EXPAND, CLARIFY, FIX_GRAMMAR, EXPLAIN }
    public enum Category { supporting, related, insufficient }
    public record Command(Kind kind, long expectedRevision, Integer placementBlock, Integer from, Integer to,
                          Action action, String instruction, List<UUID> selectedSourceIds, int lengthTarget,
                          String stylePreset, boolean citationRequired) {
        public Command {
            require(kind != null && expectedRevision > 0);
            text(instruction, 1000); require(stylePreset != null && Set.of("ACADEMIC", "CONCISE", "PLAIN").contains(stylePreset));
            require(lengthTarget >= 20 && lengthTarget <= 1000);
            if (selectedSourceIds != null) {
                selectedSourceIds = bounded(selectedSourceIds, 100);
                require(new HashSet<>(selectedSourceIds).size() == selectedSourceIds.size());
            }
            if (kind == Kind.DRAFT) require(placementBlock != null && placementBlock >= 0 && from == null && to == null
                && action == null && selectedSourceIds != null && !selectedSourceIds.isEmpty());
            else {
                require(placementBlock == null && from != null && to != null && from >= 0 && to > from);
                require(kind == Kind.REWRITE ? action != null && selectedSourceIds != null : action == null);
                require(kind != Kind.REWRITE || selectedSourceIds.isEmpty() || action == Action.EXPAND);
            }
        }
    }
    public record Match(String chunkId, Category category, double relevance, String reason) {
        public Match { hash(chunkId); require(category != null && Double.isFinite(relevance) && relevance >= 0 && relevance <= 1); text(reason, 1000); }
    }
    public record Answer(String status, String text, List<String> citationIds, List<Match> matches) {
        public Answer {
            require(Set.of("READY", "INSUFFICIENT_EVIDENCE").contains(status) && text != null && text.length() <= 12000);
            citationIds = bounded(citationIds, 12); citationIds.forEach(GenerationContracts::hash);
            require(new HashSet<>(citationIds).size() == citationIds.size());
            matches = bounded(matches, 12);
            require(matches.stream().map(Match::chunkId).distinct().count() == matches.size());
            require("READY".equals(status) ? !text.isBlank() || !matches.isEmpty() : text.isEmpty() && citationIds.isEmpty());
        }
    }
    public record Result(String schemaVersion, UUID requestId, String templateId, String templateHash,
                         ModelMetadata model, Usage usage, String providerRequestId, Answer answer) {
        public Result {
            require("1.0".equals(schemaVersion) && requestId != null && model != null && usage != null && answer != null);
            identifier(templateId); hash(templateHash); identifier(providerRequestId);
        }
        public void validateFor(Request request, Kind kind, boolean required) {
            require(requestId.equals(request.requestId()) && templateId.equals(request.templateId()) && templateHash.equals(request.templateHash()));
            var allowed = request.evidence().stream().map(Evidence::chunkId).collect(java.util.stream.Collectors.toSet());
            require(allowed.containsAll(answer.citationIds()) && answer.matches().stream().allMatch(m -> allowed.contains(m.chunkId())));
            if (kind == Kind.EVIDENCE) require(answer.text().isEmpty() && answer.citationIds().isEmpty());
            else require(answer.matches().isEmpty() && (!"READY".equals(answer.status()) || !answer.text().isBlank()));
            require(kind != Kind.DRAFT || !"READY".equals(answer.status()) || !answer.citationIds().isEmpty());
            require(!required || !"READY".equals(answer.status()) || kind == Kind.EVIDENCE || !answer.citationIds().isEmpty());
        }
    }
    public record Candidate(Citation citation, String snippet, Category category, double relevance, String reason) {}
    public record Suggestion(UUID id, UUID workspaceId, UUID documentId, UUID createdBy, String state,
                             Command command, String originalText, String generatedText, List<Citation> citations,
                             List<Candidate> candidates, List<String> warnings, Result generation,
                             ContextContracts.Summary context, Instant createdAt, Long acceptedRevision) {}
    public record Accept(long expectedRevision, String editedText, String citationChunkId) {
        public Accept {
            require(expectedRevision > 0);
            require(editedText == null || !editedText.isBlank() && editedText.length() <= 12000);
            if (citationChunkId != null) hash(citationChunkId);
        }
    }
}
