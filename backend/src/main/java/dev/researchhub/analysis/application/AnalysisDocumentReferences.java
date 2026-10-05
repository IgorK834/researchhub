package dev.researchhub.analysis.application;

import dev.researchhub.document.application.DocumentReferenceValidator;
import dev.researchhub.shared.error.*;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Component;
import tools.jackson.databind.*;
import java.util.*;

/** References remain capabilities scoped by the document workspace, never client-supplied images or code. */
@Component
@Profile("local")
public final class AnalysisDocumentReferences implements DocumentReferenceValidator {
    private final ExecutionService executions;
    private final ObjectMapper json;
    public AnalysisDocumentReferences(ExecutionService executions, ObjectMapper json) { this.executions=executions;this.json=json; }
    @Override public void validate(UUID workspace,UUID caller,String content) {
        var references=new ArrayList<JsonNode>(); collect(json.readTree(content),references,0);
        if (references.size()>50) throw invalid();
        var blockIds=new HashSet<UUID>();
        for (var node:references) {
            try {
                var attrs=node.get("attrs");
                if (!fields(node,Set.of("type","attrs")) || !fields(attrs,Set.of("blockId","reference","caption"))) throw invalid();
                if (!blockIds.add(uuid(attrs.get("blockId")))) throw invalid();
                var caption=attrs.get("caption");
                if (!caption.isString() || caption.asString().length()>1000) throw invalid();
                var ref=attrs.get("reference");
                if (!fields(ref,Set.of("analysisId","executionId","outputId","renderMode"))) throw invalid();
                var analysis=uuid(ref.get("analysisId"));var execution=uuid(ref.get("executionId"));
                if (!ref.get("outputId").isString() || !ref.get("renderMode").isString()) throw invalid();
                var record=executions.record(workspace,caller,analysis,execution);
                if (record.execution().status()!=ExecutionContracts.Status.SUCCEEDED || record.execution().result()==null)
                    throw new ConflictException("Only saved successful analysis outputs can be inserted into a document");
                var output=record.execution().result().outputs().stream().filter(o -> o.name().equals(ref.get("outputId").asString())).findFirst().orElseThrow(AnalysisDocumentReferences::invalid);
                String expected=switch (output.kind()) { case CHART -> "CHART"; case TABLE -> "TABLE"; case TEXT -> "SUMMARY"; };
                if (!expected.equals(ref.get("renderMode").asString())) throw invalid();
            } catch (IllegalArgumentException | NullPointerException malformed) { throw invalid(); }
        }
    }
    private void collect(JsonNode node,List<JsonNode> found,int depth) {
        if (depth>64) throw invalid();
        if (node.isObject()) {
            if ("analysisResult".equals(node.path("type").asString(""))) found.add(node);
            var content=node.get("content"); if (content!=null) collect(content,found,depth+1);
        } else if (node.isArray()) node.forEach(child -> collect(child,found,depth+1));
    }
    private static boolean fields(JsonNode node,Set<String> expected) {
        if (node==null || !node.isObject() || node.size()!=expected.size()) return false;
        return expected.stream().allMatch(node::has);
    }
    private static UUID uuid(JsonNode node) {
        if (node==null || !node.isString() || !node.asString().matches("[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}")) throw invalid();
        return UUID.fromString(node.asString());
    }
    private static ApiException invalid() { return new ApiException(ApiErrorCode.VALIDATION_FAILED,"Use a valid semantic reference to a saved analysis output"); }
}
