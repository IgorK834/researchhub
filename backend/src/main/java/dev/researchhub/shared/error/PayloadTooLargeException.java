package dev.researchhub.shared.error;

/** The request carried more data than the product accepts for it. {@code 413 PAYLOAD_TOO_LARGE}. */
public class PayloadTooLargeException extends ApiException {

    public PayloadTooLargeException(String detail) {
        super(ApiErrorCode.PAYLOAD_TOO_LARGE, detail);
    }

}
