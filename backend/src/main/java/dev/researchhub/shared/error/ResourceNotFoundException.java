package dev.researchhub.shared.error;

public class ResourceNotFoundException extends ApiException {

    public ResourceNotFoundException(String detail) {
        super(ApiErrorCode.RESOURCE_NOT_FOUND, detail);
    }

}
