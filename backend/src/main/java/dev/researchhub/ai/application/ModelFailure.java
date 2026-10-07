package dev.researchhub.ai.application;

import dev.researchhub.shared.error.*;

/** Never retains provider payloads, credentials, prompt text or an unsafe exception cause. */
public final class ModelFailure extends ApiException {
    private final dev.researchhub.ai.observability.AiDiagnostics.ProviderUsage telemetry;
    public dev.researchhub.ai.observability.AiDiagnostics.ProviderUsage telemetry() { return telemetry; }
    public ModelFailure(ApiErrorCode code) { this(code, null); }
    public ModelFailure(ApiErrorCode code, dev.researchhub.ai.observability.AiDiagnostics.ProviderUsage telemetry) {
        super(code, switch (code) {
            case AI_UNAVAILABLE -> "The model is temporarily unavailable; try again later";
            case AI_PROVIDER_ERROR -> "The model provider could not complete the request";
            case AI_OUTPUT_INVALID -> "The model returned an invalid structured response";
            case AI_REFUSED -> "The model could not answer this request";
            default -> throw new IllegalArgumentException("Not a model error code");
        });
        this.telemetry=telemetry;
    }
}
