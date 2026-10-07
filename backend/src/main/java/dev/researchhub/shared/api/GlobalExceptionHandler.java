package dev.researchhub.shared.api;

import dev.researchhub.shared.error.ApiErrorCode;
import dev.researchhub.shared.error.ApiException;
import jakarta.validation.ConstraintViolation;
import jakarta.validation.ConstraintViolationException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.MessageSourceResolvable;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ProblemDetail;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.validation.FieldError;
import org.springframework.validation.ObjectError;
import org.springframework.validation.method.ParameterValidationResult;
import org.springframework.web.HttpMediaTypeNotSupportedException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.HandlerMethodValidationException;
import org.springframework.web.multipart.MaxUploadSizeExceededException;
import org.springframework.web.servlet.resource.NoResourceFoundException;

import java.net.URI;
import java.util.ArrayList;
import java.util.List;

@RestControllerAdvice
public class GlobalExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(GlobalExceptionHandler.class);
    private static final URI PROBLEM_TYPE = URI.create("about:blank");

    @ExceptionHandler(ApiException.class)
    ResponseEntity<Object> handleApiException(ApiException exception) {
        String detail = exception.getMessage() == null ? title(exception.code()) : exception.getMessage();
        ProblemDetail problem = problem(exception.code(), detail);
        // Structured members a module declared on the exception, such as a stale revision's currentRevision.
        exception.properties().forEach(problem::setProperty);
        if (exception.code() == ApiErrorCode.RATE_LIMIT_EXCEEDED) {
            return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS)
                    .contentType(MediaType.APPLICATION_PROBLEM_JSON)
                    .header("Retry-After", String.valueOf(exception.properties().get("retryAfterSeconds")))
                    .header("Cache-Control", "private, no-store").body(problem);
        }
        return body(problem);
    }

    @ExceptionHandler(ConstraintViolationException.class)
    ResponseEntity<Object> handleConstraintViolation(ConstraintViolationException exception) {
        List<ApiFieldError> errors = new ArrayList<>();
        for (ConstraintViolation<?> violation : exception.getConstraintViolations()) {
            errors.add(fieldError(leaf(violation.getPropertyPath().toString()), violation.getMessage()));
        }
        return body(validationProblem(errors));
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    ResponseEntity<Object> handleMethodArgumentNotValid(MethodArgumentNotValidException exception) {
        List<ApiFieldError> errors = new ArrayList<>();
        for (FieldError fieldError : exception.getBindingResult().getFieldErrors()) {
            errors.add(fieldError(fieldError.getField(), fieldError.getDefaultMessage()));
        }
        for (ObjectError objectError : exception.getBindingResult().getGlobalErrors()) {
            errors.add(fieldError(objectError.getObjectName(), objectError.getDefaultMessage()));
        }
        return body(validationProblem(errors));
    }

    @ExceptionHandler(HandlerMethodValidationException.class)
    ResponseEntity<Object> handleHandlerMethodValidation(HandlerMethodValidationException exception) {
        List<ApiFieldError> errors = new ArrayList<>();
        for (ParameterValidationResult result : exception.getParameterValidationResults()) {
            String field = result.getMethodParameter().getParameterName();
            for (MessageSourceResolvable error : result.getResolvableErrors()) {
                errors.add(fieldError(field == null ? "request" : field, error.getDefaultMessage()));
            }
        }
        return body(validationProblem(errors));
    }

    @ExceptionHandler(HttpMessageNotReadableException.class)
    ResponseEntity<Object> handleUnreadable(HttpMessageNotReadableException exception) {
        return body(problem(ApiErrorCode.MALFORMED_REQUEST, "The request body could not be read"));
    }

    @ExceptionHandler(HttpMediaTypeNotSupportedException.class)
    ResponseEntity<Object> handleUnsupportedMediaType(HttpMediaTypeNotSupportedException exception) {
        return body(problem(ApiErrorCode.UNSUPPORTED_MEDIA_TYPE, "The request content type is not supported"));
    }

    @ExceptionHandler(MaxUploadSizeExceededException.class)
    ResponseEntity<Object> handleTooLarge(MaxUploadSizeExceededException exception) {
        return body(problem(ApiErrorCode.PAYLOAD_TOO_LARGE, "The request payload is too large"));
    }

    @ExceptionHandler(NoResourceFoundException.class)
    ResponseEntity<Object> handleMissingRoute(NoResourceFoundException exception) {
        return body(problem(ApiErrorCode.RESOURCE_NOT_FOUND, "The requested resource was not found"));
    }

    @ExceptionHandler(Exception.class)
    ResponseEntity<Object> handleUnexpected(Exception exception) {
        log.atError().addKeyValue("event", "http.request.failed")
            .addKeyValue("errorType", exception.getClass().getSimpleName()).log("Unhandled API exception");
        return body(problem(ApiErrorCode.INTERNAL_ERROR, "An unexpected error occurred"));
    }

    private static ProblemDetail validationProblem(List<ApiFieldError> errors) {
        ProblemDetail problem = problem(ApiErrorCode.VALIDATION_FAILED, "Request validation failed");
        if (!errors.isEmpty()) {
            problem.setProperty("errors", errors);
        }
        return problem;
    }

    private static ProblemDetail problem(ApiErrorCode code, String detail) {
        ProblemDetail problem = ProblemDetail.forStatusAndDetail(status(code), detail);
        problem.setType(PROBLEM_TYPE);
        problem.setTitle(title(code));
        problem.setProperty("code", code.name());
        return problem;
    }

    private static ApiFieldError fieldError(String field, String message) {
        return new ApiFieldError(field, message == null || message.isBlank() ? "Invalid value" : message);
    }

    private static String leaf(String path) {
        int separator = path.lastIndexOf('.');
        if (separator >= 0 && separator < path.length() - 1) {
            return path.substring(separator + 1);
        }
        return path;
    }

    private static ResponseEntity<Object> body(ProblemDetail problem) {
        return ResponseEntity.status(problem.getStatus())
                .contentType(MediaType.APPLICATION_PROBLEM_JSON)
                .body(problem);
    }

    private static HttpStatus status(ApiErrorCode code) {
        return switch (code) {
            case VALIDATION_FAILED, MALFORMED_REQUEST -> HttpStatus.BAD_REQUEST;
            case UNAUTHENTICATED -> HttpStatus.UNAUTHORIZED;
            case FORBIDDEN -> HttpStatus.FORBIDDEN;
            case RESOURCE_NOT_FOUND -> HttpStatus.NOT_FOUND;
            case CONFLICT, COLLABORATION_STATE_REPLACED -> HttpStatus.CONFLICT;
            case PAYLOAD_TOO_LARGE -> HttpStatus.CONTENT_TOO_LARGE;
            case UNSUPPORTED_FILE_TYPE, UNSUPPORTED_MEDIA_TYPE -> HttpStatus.UNSUPPORTED_MEDIA_TYPE;
            case AI_UNAVAILABLE, EXTERNAL_SEARCH_UNAVAILABLE -> HttpStatus.SERVICE_UNAVAILABLE;
            case AI_PROVIDER_ERROR, AI_OUTPUT_INVALID, EXTERNAL_SEARCH_FAILED -> HttpStatus.BAD_GATEWAY;
            case AI_REFUSED -> HttpStatus.UNPROCESSABLE_CONTENT;
            case AI_CONTEXT_TOO_LARGE -> HttpStatus.CONTENT_TOO_LARGE;
            case RATE_LIMIT_EXCEEDED -> HttpStatus.TOO_MANY_REQUESTS;
            case INTERNAL_ERROR -> HttpStatus.INTERNAL_SERVER_ERROR;
        };
    }

    private static String title(ApiErrorCode code) {
        return switch (code) {
            case VALIDATION_FAILED -> "Validation failed";
            case MALFORMED_REQUEST -> "Malformed request";
            case UNAUTHENTICATED -> "Unauthenticated";
            case FORBIDDEN -> "Forbidden";
            case RESOURCE_NOT_FOUND -> "Not found";
            case CONFLICT -> "Conflict";
            case COLLABORATION_STATE_REPLACED -> "Document snapshot restored";
            case PAYLOAD_TOO_LARGE -> "Payload too large";
            case UNSUPPORTED_FILE_TYPE -> "Unsupported file type";
            case UNSUPPORTED_MEDIA_TYPE -> "Unsupported media type";
            case AI_UNAVAILABLE -> "Model unavailable";
            case EXTERNAL_SEARCH_UNAVAILABLE -> "External search unavailable";
            case EXTERNAL_SEARCH_FAILED -> "External search failed";
            case AI_PROVIDER_ERROR -> "Model provider error";
            case AI_OUTPUT_INVALID -> "Invalid model response";
            case AI_REFUSED -> "Model request declined";
            case AI_CONTEXT_TOO_LARGE -> "Context budget exceeded";
            case RATE_LIMIT_EXCEEDED -> "Request limit reached";
            case INTERNAL_ERROR -> "Internal server error";
        };
    }

}
