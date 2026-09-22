package dev.researchhub.shared.error;

public class ConflictException extends ApiException {

    public ConflictException(String detail) {
        super(ApiErrorCode.CONFLICT, detail);
    }

}
