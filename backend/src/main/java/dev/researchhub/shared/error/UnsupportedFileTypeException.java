package dev.researchhub.shared.error;

public class UnsupportedFileTypeException extends ApiException {

    public UnsupportedFileTypeException(String detail) {
        super(ApiErrorCode.UNSUPPORTED_FILE_TYPE, detail);
    }

}
