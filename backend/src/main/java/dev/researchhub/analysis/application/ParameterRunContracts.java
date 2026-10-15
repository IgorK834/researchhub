package dev.researchhub.analysis.application;

import java.util.*;

public final class ParameterRunContracts {
    private ParameterRunContracts() {}
    public record Bounds(String minimum,String maximum) {}
    public record ParameterDefinition(String schemaVersion,String name,String type,String unit,Bounds bounds,String defaultValue,boolean required) {}
    public record Value(String type,String value,String unit) {}
    public record Run(UUID idempotencyKey,Map<String,Value> parameters,ReproductionContracts.InputMode inputMode,ProblemContracts.Plot plot) {
        public Run {
            if(idempotencyKey==null||parameters==null||parameters.size()>20||inputMode==null)throw new IllegalArgumentException("Invalid parameter run");
            parameters=Map.copyOf(parameters);
        }
    }
    public record Result(UUID parentAnalysisId,UUID analysisId,UUID executionId,String mode,int llmTokens) {}
}
