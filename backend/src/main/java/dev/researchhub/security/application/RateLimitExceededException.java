package dev.researchhub.security.application;

import dev.researchhub.shared.error.ApiErrorCode;
import dev.researchhub.shared.error.ApiException;
import java.util.Map;

public final class RateLimitExceededException extends ApiException {
    public RateLimitExceededException(CostCategory category, long retryAfterSeconds) {
        super(ApiErrorCode.RATE_LIMIT_EXCEEDED,
                "The request limit for this operation has been reached.",
                Map.of("quotaCategory", category.name(), "retryAfterSeconds", Math.max(1, retryAfterSeconds)));
    }
}
