package dev.researchhub.document.application;

import static org.junit.jupiter.api.Assertions.*;

import dev.researchhub.shared.math.MathAst;

import org.junit.jupiter.api.Test;

import tools.jackson.databind.json.JsonMapper;

import java.nio.file.*;
import java.util.*;

class MathDocumentValidatorTest {
    final JsonMapper json = JsonMapper.builder().findAndAddModules().build();

    @Test
    void sameClosedAstFixturesAndReadableNormalization() throws Exception {
        var fixture =
                json.readTree(
                        Files.readString(
                                Path.of("../contracts/document/math/v1/ast-fixtures.json")));
        for (var ast : fixture.path("valid")) {
            assertFalse(MathAst.notation(ast).isBlank());
            assertFalse(MathAst.plain(ast).isBlank());
            var value =
                    json.createObjectNode()
                            .put("schemaVersion", "1.0")
                            .put("notation", MathAst.notation(ast))
                            .put("accessibleText", MathAst.plain(ast))
                            .putNull("verification");
            value.set("ast", ast);
            MathAst.value(value);
            var inline = json.createObjectNode().put("type", "inlineMath");
            inline.set("attrs", json.createObjectNode().set("math", value));
            new MathDocumentValidator(json)
                    .validate(UUID.randomUUID(), UUID.randomUUID(), inline.toString());
            var block = inline.deepCopy().put("type", "blockMath");
            ((tools.jackson.databind.node.ObjectNode) block.path("attrs"))
                    .put("blockId", UUID.randomUUID().toString());
            new MathDocumentValidator(json)
                    .validate(UUID.randomUUID(), UUID.randomUUID(), block.toString());
            value.put("notation", "\\href{x}{y}");
            assertThrows(IllegalArgumentException.class, () -> MathAst.value(value));
        }
        for (var ast : fixture.path("invalid"))
            assertThrows(IllegalArgumentException.class, () -> MathAst.notation(ast));
    }

    @Test
    void hostileFieldsAndDuplicateMathIdentityCannotBeStored() {
        var validator = new MathDocumentValidator(json);
        for (String bad :
                List.of(
                        "{\"type\":\"inlineMath\",\"attrs\":{\"math\":null}}",
                        "{\"type\":\"blockMath\",\"attrs\":{\"math\":{}}}"))
            assertThrows(
                    dev.researchhub.shared.error.ApiException.class,
                    () -> validator.validate(UUID.randomUUID(), UUID.randomUUID(), bad));
    }

    @Test
    void checkedStepReferencesAreStructuralAndWorkspaceBound() throws Exception {
        var fixture =
                json.readTree(
                        Files.readString(
                                Path.of("../contracts/document/math/v1/reference-fixtures.json")));
        for (var value : fixture.path("invalid"))
            assertThrows(IllegalArgumentException.class, () -> MathAst.value(value));
        var value = fixture.path("valid").get(0).deepCopy();
        MathAst.value(value);
        var store =
                org.mockito.Mockito.mock(dev.researchhub.analysis.application.ProblemStore.class);
        var workspace = UUID.randomUUID();
        var caller = UUID.randomUUID();
        var analysis = UUID.fromString(value.path("verification").path("analysisId").asString());
        var run = UUID.fromString(value.path("verification").path("executionId").asString());
        var result = json.createObjectNode();
        var output = json.createObjectNode().put("name", "result");
        output.set(
                "steps",
                json.createArrayNode()
                        .add(json.createObjectNode().set("expression", value.path("ast"))));
        result.set("outputs", json.createArrayNode().add(output));
        var checked =
                new dev.researchhub.analysis.application.ProblemContracts.Verification(
                        "CHECKED",
                        "a".repeat(64),
                        "b".repeat(64),
                        "c".repeat(64),
                        "sha256:" + "d".repeat(64),
                        "1.2.0",
                        json.createObjectNode());
        var execution =
                new dev.researchhub.analysis.application.ProblemContracts.Execution(
                        run,
                        analysis,
                        "SUCCEEDED",
                        null,
                        java.time.Instant.now(),
                        java.time.Instant.now(),
                        checked.imageId(),
                        checked.runtimeVersion(),
                        checked.inputHash(),
                        checked.planHash(),
                        result,
                        checked);
        var node = json.createObjectNode().put("type", "inlineMath");
        node.set("attrs", json.createObjectNode().set("math", value));
        String content = node.toString();
        var validator = new MathDocumentValidator(json, store);
        org.mockito.Mockito.when(store.execution(workspace, analysis, run))
                .thenReturn(Optional.of(execution));
        validator.validate(workspace, caller, content);
        org.mockito.Mockito.when(store.execution(workspace, analysis, run))
                .thenReturn(Optional.empty());
        assertThrows(
                dev.researchhub.shared.error.ApiException.class,
                () -> validator.validate(workspace, caller, content));
        for (var invalid :
                List.of(
                        new dev.researchhub.analysis.application.ProblemContracts.Execution(
                                run,
                                analysis,
                                "FAILED",
                                "BAD",
                                execution.createdAt(),
                                execution.completedAt(),
                                execution.imageId(),
                                execution.runtimeVersion(),
                                execution.inputHash(),
                                execution.planHash(),
                                null,
                                null),
                        new dev.researchhub.analysis.application.ProblemContracts.Execution(
                                run,
                                analysis,
                                "SUCCEEDED",
                                null,
                                execution.createdAt(),
                                execution.completedAt(),
                                execution.imageId(),
                                execution.runtimeVersion(),
                                "f".repeat(64),
                                execution.planHash(),
                                result,
                                checked))) {
            org.mockito.Mockito.when(store.execution(workspace, analysis, run))
                    .thenReturn(Optional.of(invalid));
            assertThrows(
                    dev.researchhub.shared.error.ApiException.class,
                    () -> validator.validate(workspace, caller, content));
        }
        org.mockito.Mockito.when(store.execution(workspace, analysis, run))
                .thenReturn(Optional.of(execution));
        ((tools.jackson.databind.node.ObjectNode) value.path("verification")).put("stepIndex", 1);
        String badStep = node.toString();
        assertThrows(
                dev.researchhub.shared.error.ApiException.class,
                () -> validator.validate(workspace, caller, badStep));
    }

    @Test
    void portableExportRetainsInlineAndDisplayEquations() throws Exception {
        var value =
                json.readTree(
                                Files.readString(
                                        Path.of(
                                                "../contracts/document/math/v1/reference-fixtures.json")))
                        .path("valid")
                        .get(0)
                        .deepCopy();
        ((tools.jackson.databind.node.ObjectNode) value).putNull("verification");
        var inline = json.createObjectNode().put("type", "inlineMath");
        inline.set("attrs", json.createObjectNode().set("math", value));
        var block = inline.deepCopy().put("type", "blockMath");
        var paragraph = json.createObjectNode().put("type", "paragraph");
        paragraph.set("content", json.createArrayNode().add(inline));
        var doc = json.createObjectNode().put("type", "doc");
        doc.set("content", json.createArrayNode().add(paragraph).add(block));
        var report =
                new dev.researchhub.export.application.EditorReportAdapter(json)
                        .convert(
                                UUID.randomUUID(),
                                UUID.randomUUID(),
                                1,
                                "Equations",
                                doc.toString(),
                                java.time.Instant.now(),
                                org.mockito.Mockito.mock(
                                        dev.researchhub.export.application.ExportReferences.class),
                                List.of());
        assertEquals(
                "2",
                ((dev.researchhub.export.domain.Report.InlineMath)
                                ((dev.researchhub.export.domain.Report.Paragraph)
                                                report.blocks().get(0))
                                        .content()
                                        .get(0))
                        .math().source());
        assertEquals(
                "2",
                ((dev.researchhub.export.domain.Report.Equation) report.blocks().get(1)).source());
    }

    @Test
    void atomShapesMarksIdentityAndDocumentDepthAreBounded() throws Exception {
        var value =
                json.readTree(
                                Files.readString(
                                        Path.of(
                                                "../contracts/document/math/v1/reference-fixtures.json")))
                        .path("valid")
                        .get(0)
                        .deepCopy();
        ((tools.jackson.databind.node.ObjectNode) value).putNull("verification");
        var atom = json.createObjectNode().put("type", "blockMath");
        atom.set(
                "attrs",
                json.createObjectNode()
                        .put("blockId", UUID.randomUUID().toString())
                        .set("math", value));
        var validator = new MathDocumentValidator(json);
        var duplicate = json.createObjectNode().put("type", "doc");
        duplicate.set("content", json.createArrayNode().add(atom).add(atom));
        assertThrows(
                dev.researchhub.shared.error.ApiException.class,
                () ->
                        validator.validate(
                                UUID.randomUUID(), UUID.randomUUID(), duplicate.toString()));
        for (String field : List.of("content", "marks")) {
            var bad = atom.deepCopy();
            bad.set(field, json.createArrayNode().add(json.createObjectNode().put("type", "bold")));
            assertThrows(
                    dev.researchhub.shared.error.ApiException.class,
                    () -> validator.validate(UUID.randomUUID(), UUID.randomUUID(), bad.toString()));
        }
        var attrs = (tools.jackson.databind.node.ObjectNode) atom.path("attrs");
        attrs.put("unexpected", "attribute");
        assertThrows(
                dev.researchhub.shared.error.ApiException.class,
                () -> validator.validate(UUID.randomUUID(), UUID.randomUUID(), atom.toString()));
        attrs.remove("unexpected");
        attrs.put("blockId", "invalid");
        assertThrows(
                dev.researchhub.shared.error.ApiException.class,
                () -> validator.validate(UUID.randomUUID(), UUID.randomUUID(), atom.toString()));
        var nested = json.createObjectNode().put("type", "doc");
        for (int i = 0; i < 66; i++) {
            var parent = json.createObjectNode().put("type", "doc");
            parent.set("content", json.createArrayNode().add(nested));
            nested = parent;
        }
        String deep = nested.toString();
        assertThrows(
                dev.researchhub.shared.error.ApiException.class,
                () -> validator.validate(UUID.randomUUID(), UUID.randomUUID(), deep));
    }
}
