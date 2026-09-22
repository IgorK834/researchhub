package dev.researchhub.shared.error;

public class ForbiddenException extends ApiException {

    public ForbiddenException(String detail) {
        super(ApiErrorCode.FORBIDDEN, detail);
    }

}
