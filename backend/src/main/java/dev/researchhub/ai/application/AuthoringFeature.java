package dev.researchhub.ai.application;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import java.io.IOException;
import java.util.*;

@Component
public class AuthoringFeature {
    private final Map<AuthoringContracts.Kind, String> templates = new EnumMap<>(AuthoringContracts.Kind.class);
    private final GenerationContracts.Parameters parameters;
    public AuthoringFeature(@Value("${researchhub.ai.features.authoring.max-output-tokens:4096}") int tokens,
        @Value("${researchhub.ai.features.authoring.temperature:0}") String temperature) throws IOException {
        parameters = new GenerationContracts.Parameters("none".equals(temperature) ? null : Double.valueOf(temperature), tokens);
        for (var kind : AuthoringContracts.Kind.values()) templates.put(kind,
            GenerationFeature.loadInstruction("authoring-" + kind.name().toLowerCase(Locale.ROOT) + "-v1.txt"));
    }
    public GenerationPolicy policy(AuthoringContracts.Kind kind) {
        return new GenerationPolicy() {
            public String templateId() { return "authoring-" + kind.name().toLowerCase(Locale.ROOT) + ":1"; }
            public String templateHash() { return RetrievalIdentity.hash(systemInstruction()); }
            public String systemInstruction() { return templates.get(kind); }
            public GenerationContracts.Parameters parameters() { return parameters; }
        };
    }
}
