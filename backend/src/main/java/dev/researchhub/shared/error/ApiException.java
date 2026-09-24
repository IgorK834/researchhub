package dev.researchhub.shared.error;

import java.util.Map;
import java.util.Objects;
import java.util.Set;

public class ApiException extends RuntimeException {

    /**
     * Names a module may not use for an extra property, because {@code GlobalExceptionHandler} already writes
     * them. Letting a property shadow {@code code} or {@code errors} would put two contracts on one field.
     */
    private static final Set<String> RESERVED_PROPERTIES =
            Set.of("type", "title", "status", "detail", "instance", "code", "errors");

    private final ApiErrorCode code;
    private final Map<String, Object> properties;

    public ApiException(ApiErrorCode code, String detail) {
        this(code, detail, Map.of());
    }

    /**
     * An error that carries machine-readable members next to {@code code}, written into the ProblemDetail body
     * as they are.
     *
     * <p>For facts a client acts on and should not have to parse out of {@code detail} — a stale revision's
     * {@code currentRevision}, for example. Each property is part of the API contract and belongs in
     * docs/development/api-errors.md. Values must be safe to show a client, exactly like {@code detail}.
     */
    protected ApiException(ApiErrorCode code, String detail, Map<String, Object> properties) {
        super(detail);
        this.code = code;
        this.properties = Map.copyOf(Objects.requireNonNull(properties, "properties must not be null"));
        for (String name : this.properties.keySet()) {
            if (RESERVED_PROPERTIES.contains(name)) {
                throw new IllegalArgumentException("'" + name + "' is a reserved ProblemDetail member");
            }
        }
    }

    public ApiErrorCode code() {
        return code;
    }

    /** Extra ProblemDetail members, empty for most errors. */
    public Map<String, Object> properties() {
        return properties;
    }

}
