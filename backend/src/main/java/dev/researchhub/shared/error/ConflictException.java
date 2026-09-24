package dev.researchhub.shared.error;

import java.util.Map;

public class ConflictException extends ApiException {

    public ConflictException(String detail) {
        super(ApiErrorCode.CONFLICT, detail);
    }

    /** A conflict that also tells the client something structured about the state it collided with. */
    protected ConflictException(String detail, Map<String, Object> properties) {
        super(ApiErrorCode.CONFLICT, detail, properties);
    }

}
