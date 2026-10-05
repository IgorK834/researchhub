package dev.researchhub.analysis.application;

import dev.researchhub.analysis.application.AnalysisContracts.*;
import java.util.*;

/** Checks machine-readable intent against authorized inspection. Deliberately makes no claim about code safety. */
public final class AnalysisPlanValidator {
    private AnalysisPlanValidator() {}
    public static void validate(Plan plan, List<InspectedInput> inspected) {
        var references=new HashMap<String,PlanInput>();
        for (var input:plan.inputs()) {
            var source=inspected.stream().filter(i -> i.selection().sourceVersionId().equals(input.sourceVersionId()))
                .findFirst().orElseThrow(() -> invalid());
            var selected=source.selection();
            if (selected.sheetName()!=null && !selected.sheetName().equals(input.sheetName())) throw invalid();
            var sheet=source.preview().sheets().stream().filter(s -> s.name().equals(input.sheetName())).findFirst().orElseThrow(() -> invalid());
            var columns=sheet.columns().stream().map(DatasetPreview.Column::index).toList();
            if (!columns.containsAll(input.requiredColumns()) || selected.columns()!=null && !selected.columns().containsAll(input.requiredColumns())) throw invalid();
            if (references.put(key(input.sourceVersionId(),input.sheetName()),input)!=null) throw invalid();
        }
        for (var step:java.util.stream.Stream.concat(plan.transformations().stream(),plan.statisticalOperations().stream()).toList()) {
            var ref=references.get(key(step.sourceVersionId(),step.sheetName()));
            if (ref==null || !ref.requiredColumns().containsAll(step.columns())) throw invalid();
        }
        var versions=plan.inputs().stream().map(PlanInput::sourceVersionId).toList();
        if (plan.outputs().stream().anyMatch(o -> !versions.containsAll(o.sourceVersionIds()))) throw invalid();
    }
    public static void validateSelection(InspectedInput input) {
        if (!input.selection().sourceId().equals(input.preview().sourceId())
            || !input.selection().sourceVersionId().equals(input.preview().sourceVersionId())) throw invalid();
        if (input.selection().sheetName()!=null) {
            var sheet=input.preview().sheets().stream().filter(s -> s.name().equals(input.selection().sheetName())).findFirst().orElseThrow(() -> invalid());
            if (input.selection().columns()!=null && !sheet.columns().stream().map(DatasetPreview.Column::index).toList().containsAll(input.selection().columns())) throw invalid();
        }
    }
    private static String key(UUID version,String sheet) { return version+":"+sheet; }
    private static IllegalArgumentException invalid() { return new IllegalArgumentException("Plan references data outside inspected selections"); }
}
