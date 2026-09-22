package dev.researchhub.shared.error;

public class UnauthenticatedException extends ApiException {

    public UnauthenticatedException(String detail) {
        super(ApiErrorCode.UNAUTHENTICATED, detail);
    }

}
