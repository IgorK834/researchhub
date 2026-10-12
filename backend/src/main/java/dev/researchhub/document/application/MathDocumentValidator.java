package dev.researchhub.document.application;

import dev.researchhub.shared.error.*;
import dev.researchhub.shared.math.MathAst;

import org.springframework.stereotype.Component;

import tools.jackson.databind.*;

import java.util.*;

@Component
public class MathDocumentValidator implements DocumentReferenceValidator {
    private final ObjectMapper json;
    private final dev.researchhub.analysis.application.ProblemStore problems;

    @org.springframework.beans.factory.annotation.Autowired
    public MathDocumentValidator(
            ObjectMapper json, dev.researchhub.analysis.application.ProblemStore problems) {
        this.json = json;
        this.problems = problems;
    }

    public MathDocumentValidator(ObjectMapper json) {
        this(json, null);
    }

    @Override
    public void validate(UUID workspace, UUID caller, String content) {
        try {
            walk(workspace, json.readTree(content), 0, new int[] {0}, new HashSet<>());
        } catch (IllegalArgumentException invalid) {
            throw new ApiException(ApiErrorCode.VALIDATION_FAILED, "Invalid mathematical node");
        }
    }

    private void walk(UUID workspace, JsonNode n, int depth, int[] count, Set<String> ids) {
        if (depth > 64 || ++count[0] > 50000) throw new IllegalArgumentException("Document limit");
        if (Set.of("inlineMath", "blockMath").contains(n.path("type").asString(""))) {
            var a = n.path("attrs");
            MathAst.value(a.path("math"));
            var reference = a.path("math").path("verification");
            if (!reference.isNull()) {
                MathAst.require(problems != null);
                var execution =
                        problems.execution(
                                        workspace,
                                        UUID.fromString(reference.path("analysisId").asString()),
                                        UUID.fromString(reference.path("executionId").asString()))
                                .orElseThrow(
                                        () ->
                                                new IllegalArgumentException(
                                                        "Unknown calculation step"));
                MathAst.require(
                        execution.status().equals("SUCCEEDED")
                                && execution.verification() != null
                                && execution.verification().status().equals("CHECKED")
                                && execution
                                        .inputHash()
                                        .equals(reference.path("inputHash").asString())
                                && execution.result() != null);
                var output =
                        java.util.stream.StreamSupport.stream(
                                        execution.result().path("outputs").spliterator(), false)
                                .filter(
                                        o ->
                                                o.path("name")
                                                        .asString()
                                                        .equals(
                                                                reference
                                                                        .path("outputName")
                                                                        .asString()))
                                .findFirst()
                                .orElseThrow(() -> new IllegalArgumentException("Unknown output"));
                MathAst.require(
                        output.path("steps")
                                .path(reference.path("stepIndex").asInt())
                                .path("expression")
                                .equals(a.path("math").path("ast")));
            }
            if (n.has("content") || (n.path("marks").isArray() && !n.path("marks").isEmpty()))
                throw new IllegalArgumentException("Math atom children");
            for (String f : a.propertyNames())
                if (!Set.of("math", "blockId", "originIntent", "importOperationId").contains(f))
                    throw new IllegalArgumentException("Math attributes");
            if (a.hasNonNull("blockId")) {
                String id = a.path("blockId").asString();
                UUID.fromString(id);
                if (!ids.add(id)) throw new IllegalArgumentException("Duplicate math identity");
            }
        }
        for (var child : n.path("content")) walk(workspace, child, depth + 1, count, ids);
    }
}
