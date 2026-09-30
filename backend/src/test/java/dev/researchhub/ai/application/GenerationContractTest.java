package dev.researchhub.ai.application;

import dev.researchhub.ai.application.GenerationContracts.*;
import dev.researchhub.shared.error.ApiErrorCode;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.ObjectMapper;
import java.nio.file.*;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

class GenerationContractTest {
    private final ObjectMapper json = new ObjectMapper();
    @Test void javaAndPythonShareVersionedRequestAndResultFixtures() throws Exception {
        Request request = json.readValue(Files.readString(Path.of("../contracts/ai/v1/generation-request.json")), Request.class);
        Result result = json.readValue(Files.readString(Path.of("../contracts/ai/v1/generation-result.json")), Result.class);
        result.validateFor(request);
        var feature = new GenerationFeature("grounded-response:1", "0", 1024);
        assertEquals(feature.systemInstruction(), request.systemInstruction());
        assertEquals(feature.templateHash(), result.templateHash());
        assertEquals("deterministic", result.model().provider());
        assertTrue(result.usage().estimated());
        assertEquals(json.readTree(Files.readString(Path.of("../contracts/ai/v1/generation-result.json"))), json.readTree(json.writeValueAsString(result)));
    }
    @Test void configurationRejectsUnknownTemplatesAndInvalidParameters() throws Exception {
        assertThrows(IllegalArgumentException.class, () -> new GenerationFeature("unversioned", "0", 1024));
        assertThrows(IllegalArgumentException.class, () -> new GenerationFeature("grounded-response:1", "NaN", 1024));
        assertEquals(new Parameters(null, 2048), new GenerationFeature("grounded-response:1", "none", 2048).parameters());
        for (Double temperature : List.of(-1.0, 2.1, Double.NaN, Double.POSITIVE_INFINITY))
            assertThrows(IllegalArgumentException.class, () -> new Parameters(temperature, 1024));
        assertThrows(IllegalArgumentException.class, () -> new Parameters(0.0, 15));
        assertThrows(IllegalArgumentException.class, () -> new Parameters(0.0, 8193));
        assertThrows(IllegalArgumentException.class, () -> new ModelMetadata("", "model", "1", true, false));
        assertThrows(IllegalArgumentException.class, () -> new ModelMetadata("cloud", "model", "1", false, false));
        assertThrows(IllegalArgumentException.class, () -> new ModelMetadata("cloud", "model", "1", true, true));
    }
    @Test void requestAndAnswerBoundsAreExplicit() {
        assertThrows(IllegalArgumentException.class, () -> new Evidence("a".repeat(64), "b".repeat(64), "text"));
        assertThrows(IllegalArgumentException.class, () -> new Command(" ", List.of()));
        assertThrows(IllegalArgumentException.class, () -> new Command("x".repeat(4001), List.of()));
        var ref = new EvidenceReference(UUID.randomUUID(), "a".repeat(64), "version-1");
        assertThrows(IllegalArgumentException.class, () -> new Command("instruction", List.of(ref, ref)));
        assertThrows(IllegalArgumentException.class, () -> new Command("instruction", Collections.nCopies(13, ref)));
        assertThrows(IllegalArgumentException.class, () -> new EvidenceReference(null, "a".repeat(64), "1"));
        assertThrows(IllegalArgumentException.class, () -> new EvidenceReference(UUID.randomUUID(), "invalid", "1"));
        assertThrows(IllegalArgumentException.class, () -> new EvidenceReference(UUID.randomUUID(), "a".repeat(64), " spaced "));
        assertThrows(IllegalArgumentException.class, () -> new Claim("text", List.of()));
        assertThrows(IllegalArgumentException.class, () -> new Claim("text", List.of("a".repeat(64), "a".repeat(64))));
        assertThrows(IllegalArgumentException.class, () -> new Answer("SUPPORTED", List.of()));
        assertThrows(IllegalArgumentException.class, () -> new Answer("OTHER", List.of()));
        assertThrows(IllegalArgumentException.class, () -> new Usage(-1, 0, -1, false));
        assertThrows(IllegalArgumentException.class, () -> new Usage(1, 2, 4, false));
        assertThrows(IllegalArgumentException.class, () -> new ModelFailure(ApiErrorCode.INTERNAL_ERROR));
        for (var code : List.of(ApiErrorCode.AI_UNAVAILABLE, ApiErrorCode.AI_PROVIDER_ERROR, ApiErrorCode.AI_OUTPUT_INVALID, ApiErrorCode.AI_REFUSED))
            assertNull(new ModelFailure(code).getCause());
    }
}
