package dev.researchhub.analysis.application;

import dev.researchhub.analysis.domain.AnalysisStatus;
import dev.researchhub.ai.application.GenerationContracts.*;
import java.time.Instant;
import java.util.*;

/** RH-140/141 v1 wire contracts. Column references are physical 1-based indices, not ambiguous/truncated labels. */
public final class AnalysisContracts {
    private AnalysisContracts() {}
    public record Input(UUID sourceId, UUID sourceVersionId, String sheetName, List<Integer> columns) {
        public Input {
            require(sourceId != null && sourceVersionId != null);
            if (sheetName != null) text(sheetName,96);
            if (columns != null) {
                columns=items(columns,100); require(!columns.isEmpty() && sheetName != null);
                require(new HashSet<>(columns).size()==columns.size());
                columns.forEach(i -> require(i >= 1 && i <= 100));
            }
        }
    }
    public record Create(String userPrompt, List<Input> inputs) {
        public Create {
            text(userPrompt,4000); inputs=items(inputs,5); require(!inputs.isEmpty());
            require(inputs.stream().map(Input::sourceVersionId).distinct().count()==inputs.size());
        }
    }
    public record Analysis(UUID id, UUID workspaceId, UUID createdBy, String userPrompt, AnalysisStatus status,
                           Instant createdAt, Instant updatedAt, List<Input> inputs, UUID planId, Plan plan, String failureCode) {}
    public record InspectedInput(Input selection, DatasetPreview preview) {}
    public record PlanningRequest(String schemaVersion, UUID analysisId, Request request,
                                  List<InspectedInput> inputs, List<String> repairHints) {}
    /** A bounded candidate is retained even if its JSON plan is invalid; it is never evaluated. */
    public record Candidate(String schemaVersion, UUID requestId, ModelMetadata model, Usage usage,
                            String providerRequestId, String output) {
        public Candidate {
            require("1.0".equals(schemaVersion) && requestId != null && model != null && usage != null);
            text(providerRequestId,200); text(output,64000);
        }
    }
    public record PlanInput(UUID sourceVersionId, String sheetName, List<Integer> requiredColumns) {
        public PlanInput { require(sourceVersionId != null); text(sheetName,96); requiredColumns=indices(requiredColumns); }
    }
    public record Step(String name, String description, UUID sourceVersionId, String sheetName, List<Integer> columns) {
        public Step { text(name,100); text(description,1000); require(sourceVersionId != null); text(sheetName,96); columns=indices(columns); }
    }
    public enum OutputKind { TABLE, CHART, TEXT }
    public record Output(OutputKind kind, String name, String description, List<UUID> sourceVersionIds) {
        public Output {
            require(kind != null); text(name,100); text(description,1000);
            sourceVersionIds=items(sourceVersionIds,5);
            require(!sourceVersionIds.isEmpty() && new HashSet<>(sourceVersionIds).size()==sourceVersionIds.size());
        }
    }
    public record Code(String language, String source) {
        public Code { require("PYTHON".equals(language)); text(source,32000); }
    }
    public record Plan(String schemaVersion, String summary, List<PlanInput> inputs, List<Step> transformations,
                       List<Step> statisticalOperations, List<Output> outputs, List<String> assumptions,
                       List<String> warnings, Code code) {
        public Plan {
            require("1.0".equals(schemaVersion) && code != null); text(summary,2000);
            inputs=items(inputs,50); require(!inputs.isEmpty());
            transformations=items(transformations,20); statisticalOperations=items(statisticalOperations,20);
            outputs=items(outputs,10); require(!outputs.isEmpty());
            require(outputs.stream().map(Output::name).distinct().count()==outputs.size());
            assumptions=notes(assumptions); warnings=notes(warnings);
        }
    }
    public record PlanAudit(UUID id, int attempt, UUID requestedBy, PlanningRequest request, Candidate candidate,
                            Plan plan, String failureCode, Instant createdAt) {}
    private static List<Integer> indices(List<Integer> values) {
        values=items(values,100); require(!values.isEmpty() && new HashSet<>(values).size()==values.size());
        values.forEach(i -> require(i>=1 && i<=100)); return values;
    }
    private static List<String> notes(List<String> values) {
        values=items(values,20); values.forEach(s -> text(s,1000)); return values;
    }
    private static <T> List<T> items(List<T> values,int max) {
        require(values != null && values.size()<=max && values.stream().noneMatch(Objects::isNull));
        return List.copyOf(values);
    }
    private static void text(String value,int max) { require(value!=null && !value.isBlank() && value.length()<=max); }
    private static void require(boolean valid) { if (!valid) throw new IllegalArgumentException("Invalid analysis contract"); }
}
