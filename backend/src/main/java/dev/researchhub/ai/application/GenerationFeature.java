package dev.researchhub.ai.application;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Component;
import java.io.IOException;
import java.nio.charset.StandardCharsets;

/** Versioned server-owned template and feature parameters; no controller/provider defaults. */
@Component
public class GenerationFeature implements GenerationPolicy {
    public static final String FEATURE_ID = "grounded-response";
    private final String templateId;
    private final String instruction;
    private final GenerationContracts.Parameters parameters;
    public GenerationFeature(@Value("${researchhub.ai.features.grounded-response.template-id:grounded-response:2}") String templateId,
        @Value("${researchhub.ai.features.grounded-response.temperature:0}") String temperature,
        @Value("${researchhub.ai.features.grounded-response.max-output-tokens:1024}") int maxOutputTokens) throws IOException {
        if (!java.util.Set.of("grounded-response:1", "grounded-response:2").contains(templateId)) throw new IllegalArgumentException("Unknown generation template");
        this.templateId = templateId;
        this.parameters = new GenerationContracts.Parameters("none".equals(temperature) ? null : Double.valueOf(temperature), maxOutputTokens);
        this.instruction = loadInstruction("grounded-response-v" + templateId.substring(templateId.indexOf(':') + 1) + ".txt");
    }
    public String templateId() { return templateId; }
    public String templateHash() { return RetrievalIdentity.hash(instruction); }
    public String systemInstruction() { return instruction; }
    public GenerationContracts.Parameters parameters() { return parameters; }
    static String loadInstruction(String resource) throws IOException {
        try (var stream = new ClassPathResource("ai/templates/" + resource).getInputStream()) {
            String text = new String(stream.readAllBytes(), StandardCharsets.UTF_8);
            GenerationContracts.text(text, 4000);
            return text;
        }
    }
}
