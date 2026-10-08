package dev.researchhub.ai.application;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/** Server feature configuration, never accepted from a browser request. */
@Component
public class ContextProperties {
    private final ContextContracts.Budget budget;
    public ContextProperties(@Value("${researchhub.ai.features.grounded-response.context.max-tokens:32768}") int maxTokens,
        @Value("${researchhub.ai.features.grounded-response.context.max-bytes:24576}") int maxBytes,
        @Value("${researchhub.ai.features.grounded-response.context.collapse-exact-duplicates:true}") boolean collapse) {
        budget = new ContextContracts.Budget(maxTokens, maxBytes, collapse);
    }
    public ContextContracts.Budget budget() { return budget; }
}
