package dev.researchhub.ai.application;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Component;

/** Retrieval limits belong to feature configuration; model/context configuration stays in the gateway. */
@Component
@Profile("local")
public class QuestionFeature implements GenerationPolicy {
    private final int topK;
    private final String instruction;
    private final GenerationContracts.Parameters parameters;
    public QuestionFeature(@Value("${researchhub.ai.features.workspace-question.top-k:6}") int topK,
        @Value("${researchhub.ai.features.workspace-question.temperature:0}") String temperature,
        @Value("${researchhub.ai.features.workspace-question.max-output-tokens:1024}") int maxOutputTokens) throws java.io.IOException {
        if (topK < 1 || topK > 12) throw new IllegalArgumentException("Question top-k must be between 1 and 12");
        this.topK = topK;
        this.parameters = new GenerationContracts.Parameters("none".equals(temperature) ? null : Double.valueOf(temperature), maxOutputTokens);
        this.instruction = GenerationFeature.loadInstruction("workspace-question-v1.txt");
    }
    public int topK() { return topK; }
    public String templateId() { return "workspace-question:1"; }
    public String templateHash() { return RetrievalIdentity.hash(instruction); }
    public String systemInstruction() { return instruction; }
    public GenerationContracts.Parameters parameters() { return parameters; }
}
