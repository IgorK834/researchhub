package dev.researchhub.shared.api;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.not;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Security filters are switched off for this slice ({@code addFilters = false}).
 *
 * <p>These tests assert how {@link GlobalExceptionHandler} maps application exceptions to the
 * {@code ProblemDetail} contract, on a test-only controller that exists solely to throw them. With
 * Spring Security on the classpath, {@code @WebMvcTest} installs its filter chain, and the real rule
 * (deny by default) would answer every request here with 401 before any handler ran — testing the
 * filter chain instead of the exception handler.
 *
 * <p>The production rules are unchanged and are covered elsewhere: the public and protected routes in
 * {@code AuthApiIntegrationTest} and {@code AuthSessionIntegrationTest}, and the public health probes in
 * {@code HealthEndpointIntegrationTest}, all run with the real chain.
 */
@WebMvcTest(controllers = ErrorHandlingTestController.class)
@Import(GlobalExceptionHandler.class)
@ActiveProfiles("error-handling-test")
@AutoConfigureMockMvc(addFilters = false)
class GlobalExceptionHandlerIntegrationTest {

    @Autowired
    private MockMvc mockMvc;

    @Test
    void validationFailureNamesTheInvalidField() throws Exception {
        mockMvc.perform(post("/api/_test/errors/validation")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isBadRequest())
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON))
                .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"))
                .andExpect(jsonPath("$.status").value(400))
                .andExpect(jsonPath("$.errors[0].field").value("name"))
                .andExpect(jsonPath("$.errors[0].message").value("must not be blank"));
    }

    @Test
    void whitespaceOnlyNameIsTrimmedThenRejectedAsBlank() throws Exception {
        mockMvc.perform(post("/api/_test/errors/validation")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\": \"   \"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"))
                .andExpect(jsonPath("$.errors[0].field").value("name"))
                .andExpect(jsonPath("$.errors[0].message").value("must not be blank"));
    }

    @Test
    void overMaxLengthNameIsRejected() throws Exception {
        String tooLong = "a".repeat(256);
        mockMvc.perform(post("/api/_test/errors/validation")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\": \"" + tooLong + "\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"))
                .andExpect(jsonPath("$.errors[0].field").value("name"))
                .andExpect(jsonPath("$.errors[0].message").value("size must be between 0 and 255"));
    }

    @Test
    void validRequestIsTrimmedAtTheApiBoundary() throws Exception {
        mockMvc.perform(post("/api/_test/errors/validation")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\": \"  Alice  \", \"title\": \"  Report Title  \"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.name").value("Alice"))
                .andExpect(jsonPath("$.title").value("Report Title"));
    }

    @Test
    void malformedJsonDoesNotEchoParserInternals() throws Exception {
        mockMvc.perform(post("/api/_test/errors/body")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("MALFORMED_REQUEST"))
                .andExpect(jsonPath("$.detail").value("The request body could not be read"))
                .andExpect(content().string(not(containsString("HttpMessageNotReadableException"))));
    }

    @Test
    void missingAuthenticationUsesApplicationCodeWithoutSpringSecurity() throws Exception {
        mockMvc.perform(get("/api/_test/errors/unauthenticated"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("UNAUTHENTICATED"))
                .andExpect(jsonPath("$.detail").value("Authentication is required"))
                .andExpect(content().string(not(containsString("UnauthenticatedException"))));
    }

    @Test
    void forbiddenCallerIsDistinctFromMissingAuthentication() throws Exception {
        mockMvc.perform(get("/api/_test/errors/forbidden"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("FORBIDDEN"));
    }

    @Test
    void missingResourceUsesNotFoundCode() throws Exception {
        mockMvc.perform(get("/api/_test/errors/missing"))
                .andExpect(status().isNotFound())
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON))
                .andExpect(jsonPath("$.code").value("RESOURCE_NOT_FOUND"))
                .andExpect(jsonPath("$.detail").value("Workspace was not found"))
                .andExpect(content().string(not(containsString("ResourceNotFoundException"))));
    }

    @Test
    void lostUpdateUsesConflictCode() throws Exception {
        mockMvc.perform(get("/api/_test/errors/conflict"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("CONFLICT"))
                .andExpect(jsonPath("$.currentRevision").doesNotExist());
    }

    @Test
    void aConflictWithStructuredPropertiesWritesThemNextToTheCode() throws Exception {
        mockMvc.perform(get("/api/_test/errors/conflict-with-revision"))
                .andExpect(status().isConflict())
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON))
                .andExpect(jsonPath("$.code").value("CONFLICT"))
                .andExpect(jsonPath("$.title").value("Conflict"))
                .andExpect(jsonPath("$.detail").value("The resource was updated by someone else"))
                .andExpect(jsonPath("$.currentRevision").value(7));
    }

    @Test
    void rejectedFileTypeUsesUnsupportedFileTypeCode() throws Exception {
        mockMvc.perform(get("/api/_test/errors/unsupported-file"))
                .andExpect(status().isUnsupportedMediaType())
                .andExpect(jsonPath("$.code").value("UNSUPPORTED_FILE_TYPE"));
    }

    @Test
    void wrongContentTypeUsesUnsupportedMediaTypeCode() throws Exception {
        mockMvc.perform(post("/api/_test/errors/json-only")
                        .contentType(MediaType.TEXT_PLAIN)
                        .content("hello"))
                .andExpect(status().isUnsupportedMediaType())
                .andExpect(jsonPath("$.code").value("UNSUPPORTED_MEDIA_TYPE"));
    }

    @Test
    void oversizedUploadUsesPayloadTooLargeCode() throws Exception {
        mockMvc.perform(get("/api/_test/errors/too-large"))
                .andExpect(status().is(413))
                .andExpect(jsonPath("$.code").value("PAYLOAD_TOO_LARGE"))
                .andExpect(content().string(not(containsString("MaxUploadSizeExceededException"))));
    }

    @Test
    void unexpectedFailureHidesServerInternals() throws Exception {
        mockMvc.perform(get("/api/_test/errors/boom"))
                .andExpect(status().isInternalServerError())
                .andExpect(jsonPath("$.code").value("INTERNAL_ERROR"))
                .andExpect(jsonPath("$.detail").value("An unexpected error occurred"))
                .andExpect(content().string(not(containsString("super-secret"))))
                .andExpect(content().string(not(containsString("IllegalStateException"))));
    }

}
