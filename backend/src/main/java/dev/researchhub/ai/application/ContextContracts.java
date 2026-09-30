package dev.researchhub.ai.application;

import java.util.*;
import static dev.researchhub.ai.application.GenerationContracts.*;

/** Context v1 is independent of provider/tokenizer. Keys are local to this immutable request. */
public final class ContextContracts {
    private ContextContracts() {}
    public record Budget(int maxTokens, int maxBytes, boolean collapseExactDuplicates) {
        public Budget { require(maxTokens >= 64 && maxTokens <= 131072 && maxBytes >= 64 && maxBytes <= 131072); }
    }
    public record Binding(String citationKey, String chunkId, String textReference) {
        public Binding {
            require(citationKey != null && citationKey.matches("S(?:[1-9]|1[0-2])")); hash(chunkId);
            require(textReference == null || textReference.matches("S(?:[1-9]|1[0-2])"));
        }
    }
    /** Persisted/public summary deliberately contains no prompt/source text. */
    public record Summary(String builderVersion, String tokenPolicy, Budget budget, String contextHash,
                          int contextBytes, long tokenUpperBound, List<Binding> citations) {
        public Summary {
            require("1.0".equals(builderVersion) && "utf8-conservative-v1".equals(tokenPolicy) && budget != null);
            hash(contextHash); require(contextBytes >= 0 && contextBytes <= budget.maxBytes() && tokenUpperBound >= 0 && tokenUpperBound <= budget.maxTokens());
            citations = bounded(citations, 12);
            var keys = new HashSet<String>(); var chunks = new HashSet<String>();
            for (int index = 0; index < citations.size(); index++) {
                var binding = citations.get(index);
                require(binding.citationKey().equals("S" + (index + 1)) && chunks.add(binding.chunkId()));
                require(binding.textReference() == null || keys.contains(binding.textReference()));
                keys.add(binding.citationKey());
            }
        }
    }
    public record BuiltContext(Summary summary, String text) {
        public BuiltContext {
            Objects.requireNonNull(summary); Objects.requireNonNull(text);
            require(RetrievalIdentity.hash(text).equals(summary.contextHash()));
            require(text.getBytes(java.nio.charset.StandardCharsets.UTF_8).length == summary.contextBytes());
        }
    }
    /** v2 wraps the unchanged v1 model contract; old stored responses remain readable. */
    public record ContextualRequest(String schemaVersion, GenerationContracts.Request request, BuiltContext context) {
        public ContextualRequest {
            require("2.0".equals(schemaVersion) && request != null && context != null);
            require(context.summary().citations().stream().map(Binding::chunkId).toList()
                .equals(request.evidence().stream().map(Evidence::chunkId).toList()));
        }
    }
}
