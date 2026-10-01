package dev.researchhub.ai.application;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Component;
import java.io.IOException;
import java.util.*;

@Component
@Profile("local")
public class SourceAnalysisFeature {
    private final Map<SourceAnalysisContracts.Kind,String> templates = new EnumMap<>(SourceAnalysisContracts.Kind.class);
    private final GenerationContracts.Parameters parameters;
    private final ContextContracts.Budget budget;
    public SourceAnalysisFeature(@Value("${researchhub.ai.features.source-analysis.max-output-tokens:6144}") int tokens,
        @Value("${researchhub.ai.features.source-analysis.temperature:0}") String temperature,
        @Value("${researchhub.ai.features.source-analysis.context.max-tokens:98304}") int maxTokens,
        @Value("${researchhub.ai.features.source-analysis.context.max-bytes:65536}") int maxBytes) throws IOException {
        parameters = new GenerationContracts.Parameters("none".equals(temperature) ? null : Double.valueOf(temperature), tokens);
        budget = new ContextContracts.Budget(maxTokens, maxBytes, true);
        for (var kind : SourceAnalysisContracts.Kind.values()) templates.put(kind,
            GenerationFeature.loadInstruction("source-" + kind.name().toLowerCase(Locale.ROOT) + "-v1.txt"));
    }
    GenerationPolicy policy(SourceAnalysisContracts.Kind kind) {
        return new GenerationPolicy() {
            public String templateId() { return "source-" + kind.name().toLowerCase(Locale.ROOT) + ":1"; }
            public String templateHash() { return RetrievalIdentity.hash(systemInstruction()); }
            public String systemInstruction() { return templates.get(kind); }
            public GenerationContracts.Parameters parameters() { return parameters; }
        };
    }
    ContextContracts.Budget budget() { return budget; }
}
