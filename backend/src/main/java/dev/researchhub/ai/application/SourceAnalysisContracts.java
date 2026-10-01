package dev.researchhub.ai.application;

import java.time.Instant;
import java.util.*;
import static dev.researchhub.ai.application.GenerationContracts.*;

/** Explicit v1 comparison boundary. Evidence ids are immutable retrieval chunk ids, never model URLs. */
public final class SourceAnalysisContracts {
    private SourceAnalysisContracts() {}
    public enum Kind { COMPARISON, DISAGREEMENTS }
    public enum Category { POTENTIAL_DISAGREEMENT, DIFFERENT_REPORTED_RESULT, DIFFERENT_EXPERIMENTAL_CONDITIONS }
    public static final List<String> DEFAULT_CRITERIA = List.of("method", "dataset", "metric", "main result", "limitations");
    public record Compare(List<UUID> selectedSourceIds, List<String> criteria, String instruction) {
        public Compare {
            selectedSourceIds = bounded(selectedSourceIds, 5);
            require(selectedSourceIds.size() >= 2 && new HashSet<>(selectedSourceIds).size() == selectedSourceIds.size());
            criteria = criteria == null || criteria.isEmpty() ? DEFAULT_CRITERIA : bounded(criteria, 5);
            criteria = criteria.stream().map(c -> { text(c, 64); return c.strip(); }).toList();
            require(criteria.stream().map(c -> c.toLowerCase(Locale.ROOT)).distinct().count() == criteria.size());
            instruction = instruction == null || instruction.isBlank() ? "Compare the selected sources using the requested criteria." : instruction;
            text(instruction, 1000);
        }
    }
    public record FollowUp(String instruction) {
        public FollowUp {
            instruction = instruction == null || instruction.isBlank() ? "Identify potential disagreements and methodological or contextual differences." : instruction;
            text(instruction, 1000);
        }
    }
    public record Cell(String criterion, String status, String text, List<String> evidenceIds) {
        public Cell {
            GenerationContracts.text(criterion, 64);
            require(Set.of("REPORTED", "MISSING").contains(status));
            evidenceIds = ids(evidenceIds);
            require("MISSING".equals(status) ? text == null && evidenceIds.isEmpty() : text != null && !text.isBlank() && text.length() <= 1200 && !evidenceIds.isEmpty());
        }
    }
    public record Row(UUID sourceId, List<Cell> cells) {
        public Row { require(sourceId != null); cells = bounded(cells, 5); }
    }
    public record Statement(String text, List<String> evidenceIds) {
        public Statement { GenerationContracts.text(text, 2000); evidenceIds = ids(evidenceIds); require(!evidenceIds.isEmpty()); }
    }
    public record Side(UUID sourceId, String text, List<String> evidenceIds) {
        public Side { require(sourceId != null); GenerationContracts.text(text, 1200); evidenceIds = ids(evidenceIds); require(!evidenceIds.isEmpty()); }
    }
    public record Finding(Category category, String description, List<Side> sides, Cell methodologicalContext) {
        public Finding {
            require(category != null && methodologicalContext != null);
            text(description, 2000); sides = bounded(sides, 2);
            require(sides.size() == 2 && !sides.get(0).sourceId().equals(sides.get(1).sourceId()));
        }
    }
    public record Answer(String status, List<Row> rows, List<Statement> summary, List<Finding> findings) {
        public Answer {
            require(Set.of("READY", "INSUFFICIENT_EVIDENCE", "NO_POTENTIAL_DISAGREEMENT").contains(status));
            rows = bounded(rows, 5); summary = bounded(summary, 5); findings = bounded(findings, 5);
        }
        public void validateFor(Kind kind, List<UUID> sourceIds, List<String> criteria, Map<String,UUID> evidence) {
            if (kind == Kind.COMPARISON) {
                require(findings.isEmpty() && rows.stream().map(Row::sourceId).toList().equals(sourceIds));
                for (var row : rows) {
                    require(row.cells().stream().map(Cell::criterion).toList().equals(criteria));
                    row.cells().forEach(c -> scoped(c.evidenceIds(), row.sourceId(), evidence));
                }
                boolean reported = rows.stream().flatMap(r -> r.cells().stream()).anyMatch(c -> "REPORTED".equals(c.status()));
                require(reported ? "READY".equals(status) && !summary.isEmpty() : "INSUFFICIENT_EVIDENCE".equals(status) && summary.isEmpty());
                summary.forEach(s -> require(evidence.keySet().containsAll(s.evidenceIds())));
            } else {
                require(rows.isEmpty() && summary.isEmpty());
                require(findings.isEmpty() ? !"READY".equals(status) : "READY".equals(status));
                if ("INSUFFICIENT_EVIDENCE".equals(status)) require(new HashSet<>(evidence.values()).size() < 2);
                else require(new HashSet<>(evidence.values()).size() >= 2);
                for (var f : findings) {
                    f.sides().forEach(s -> { require(sourceIds.contains(s.sourceId())); scoped(s.evidenceIds(), s.sourceId(), evidence); });
                    require(evidence.keySet().containsAll(f.methodologicalContext().evidenceIds()));
                }
            }
        }
    }
    public record Result(String schemaVersion, UUID requestId, String templateId, String templateHash,
                         ModelMetadata model, Usage usage, String providerRequestId, Answer answer) {
        public Result {
            require("1.0".equals(schemaVersion) && requestId != null && model != null && usage != null && answer != null);
            identifier(templateId); hash(templateHash); identifier(providerRequestId);
        }
        public void validateFor(Request request, Kind kind, List<UUID> sourceIds, List<String> criteria, Map<String,UUID> evidence) {
            require(requestId.equals(request.requestId()) && templateId.equals(request.templateId()) && templateHash.equals(request.templateHash()));
            require(evidence.keySet().equals(request.evidence().stream().map(Evidence::chunkId).collect(java.util.stream.Collectors.toSet())));
            answer.validateFor(kind, sourceIds, criteria, evidence);
        }
    }
    public record Source(UUID id, String title) {}
    public record Analysis(UUID id, UUID workspaceId, UUID createdBy, Kind kind, UUID parentComparisonId,
                           Compare command, String analysisInstruction, List<Source> sources, Answer answer, List<Citation> evidence,
                           List<String> warnings, Result generation, ContextContracts.Summary context, Instant createdAt) {}
    private static List<String> ids(List<String> values) {
        var ids = bounded(values, 12); ids.forEach(GenerationContracts::hash);
        require(new HashSet<>(ids).size() == ids.size()); return ids;
    }
    private static void scoped(List<String> ids, UUID source, Map<String,UUID> evidence) {
        require(ids.stream().allMatch(id -> source.equals(evidence.get(id))));
    }
}
