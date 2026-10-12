package dev.researchhub.analysis.application;

import dev.researchhub.ai.application.RetrievalIdentity;

import tools.jackson.databind.*;

import java.util.*;

public final class ProblemJson {
    private ProblemJson() {}

    public static String canonical(ObjectMapper json, Object value) {
        return json.writeValueAsString(ordered(json.valueToTree(value)));
    }

    private static Object ordered(JsonNode n) {
        if (n.isObject()) {
            var m = new TreeMap<String, Object>();
            n.properties().forEach(e -> m.put(e.getKey(), ordered(e.getValue())));
            return m;
        }
        if (n.isArray()) {
            var l = new ArrayList<Object>();
            n.forEach(v -> l.add(ordered(v)));
            return l;
        }
        return n;
    }

    public static String hash(ObjectMapper json, Object value) {
        return RetrievalIdentity.hash(canonical(json, value));
    }
}
