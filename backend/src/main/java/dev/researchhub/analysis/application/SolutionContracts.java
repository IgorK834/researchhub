package dev.researchhub.analysis.application;

import dev.researchhub.shared.math.MathAst;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import java.util.*;

/** Saved checked arithmetic and explicitly unchecked interpretation. No CAS or inference here. */
public final class SolutionContracts {
    private SolutionContracts() {}
    public record Step(String id, String outputId, int index, String operation, JsonNode expression,
                       JsonNode substitution, JsonNode values, String unit, String check) {}
    public record Interpretation(String status, String summary, List<String> assumptions, List<String> warnings) {}
    public record Bundle(String schemaVersion, String kind, String workload, UUID analysisId, UUID executionId,
                         String inputHash, String planHash, String candidateHash, String imageId,
                         String runtimeVersion, Map<String,String> codeHashes, String verificationVersion,
                         JsonNode precision, String domain, String statement, List<ProblemContracts.Parameter> inputs,
                         List<ProblemContracts.Unknown> unknowns, List<Step> steps, JsonNode outputs,
                         JsonNode plot, JsonNode receipt, Interpretation interpretation, JsonNode origin) {}

    public static Bundle assemble(ObjectMapper json, ProblemContracts.Analysis a, UUID execution,
                                  JsonNode candidate, ProblemContracts.Verification check, Map<String,String> codeHashes) {
        MathAst.require(check != null && check.status().equals("CHECKED") && candidate != null);
        MathAst.require(a.snapshot().inputHash().equals(check.inputHash())
            && ProblemJson.hash(json,a.plan()).equals(check.planHash())
            && ProblemJson.hash(json,candidate).equals(check.candidateHash()));
        MathAst.require(codeHashes != null && codeHashes.keySet().equals(Set.of("problem.py","verify_problem.py"))
            && codeHashes.values().stream().allMatch(v -> v != null && v.matches("[a-f0-9]{64}")));
        var steps=new ArrayList<Step>();
        for (var output:candidate.path("outputs")) {
            String name=output.path("name").asString();
            var expected=a.plan().outputs().stream().filter(o -> o.name().equals(name)).findFirst().orElseThrow();
            MathAst.require(output.path("steps").isArray() && output.path("steps").size()>=1 && output.path("steps").size()<=4);
            int index=0;
            for (var step:output.path("steps")) {
                MathAst.fields(step,"operation","expression","substitution","values","unit");
                MathAst.require(step.path("operation").asString().equals(expected.kind())
                    && step.path("expression").equals(expected.expression())
                    && step.path("values").equals(output.path("values"))
                    && step.path("unit").asString().equals(expected.unit()));
                var substitutions=step.path("substitution");
                MathAst.require(substitutions.isObject() && substitutions.size()==a.snapshot().problem().parameters().size());
                for (var parameter:a.snapshot().problem().parameters()) {
                    var value=substitutions.path(parameter.symbol());
                    MathAst.fields(value,"value","unit","siValue");
                    MathAst.require(value.path("value").asString().equals(parameter.value())
                        && value.path("unit").asString().equals(parameter.unit())
                        && value.path("siValue").isString() && value.path("siValue").asString().length()<=256);
                }
                String id=UUID.nameUUIDFromBytes((a.id()+":"+execution+":"+name+":"+index).getBytes(StandardCharsets.UTF_8)).toString();
                steps.add(new Step(id,name,index++,expected.kind(),step.path("expression").deepCopy(),
                    substitutions.deepCopy(),step.path("values").deepCopy(),expected.unit(),"CHECKED"));
            }
        }
        MathAst.require(!steps.isEmpty() && steps.size()<=32);
        var bundle=new Bundle("3.0","SOLUTION","PROBLEM",a.id(),execution,check.inputHash(),check.planHash(),check.candidateHash(),
            check.imageId(),check.runtimeVersion(),Map.copyOf(codeHashes),check.receipt().path("schemaVersion").asString(),
            check.receipt().path("tolerance").deepCopy(),a.snapshot().problem().domain(),a.snapshot().problem().statement(),a.snapshot().problem().parameters(),
            a.snapshot().problem().unknowns(),List.copyOf(steps),candidate.path("outputs").deepCopy(),candidate.path("plot").deepCopy(),
            check.receipt().deepCopy(),new Interpretation("NOT_CHECKED",a.plan().summary(),a.plan().assumptions(),a.plan().warnings()),a.snapshot().origin());
        MathAst.require(ProblemJson.canonical(json,bundle).getBytes(StandardCharsets.UTF_8).length<=262144);
        return bundle;
    }
}
