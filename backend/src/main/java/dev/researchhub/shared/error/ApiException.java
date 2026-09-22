package dev.researchhub.shared.error;

public class ApiException extends RuntimeException {

    private final ApiErrorCode code;

    public ApiException(ApiErrorCode code, String detail) {
        super(detail);
        this.code = code;
    }

    public ApiErrorCode code() {
        return code;
    }

}
