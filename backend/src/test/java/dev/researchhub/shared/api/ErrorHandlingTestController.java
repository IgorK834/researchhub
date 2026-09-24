package dev.researchhub.shared.api;

import dev.researchhub.shared.error.ConflictException;
import dev.researchhub.shared.error.ForbiddenException;
import dev.researchhub.shared.error.ResourceNotFoundException;
import dev.researchhub.shared.error.UnauthenticatedException;
import dev.researchhub.shared.error.UnsupportedFileTypeException;
import dev.researchhub.shared.validation.FieldLengths;
import dev.researchhub.shared.validation.Normalize;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import org.springframework.context.annotation.Profile;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MaxUploadSizeExceededException;

import java.util.Map;

@Profile("error-handling-test")
@RestController
@RequestMapping("/api/_test/errors")
public class ErrorHandlingTestController {

    @PostMapping("/validation")
    NameBody validation(@Valid @RequestBody NameBody body) {
        return body;
    }

    @PostMapping(value = "/body", consumes = MediaType.APPLICATION_JSON_VALUE)
    void body(@RequestBody Map<String, Object> body) {
    }

    @PostMapping(value = "/json-only", consumes = MediaType.APPLICATION_JSON_VALUE)
    void jsonOnly(@RequestBody Map<String, Object> body) {
    }

    @GetMapping("/unauthenticated")
    void unauthenticated() {
        throw new UnauthenticatedException("Authentication is required");
    }

    @GetMapping("/forbidden")
    void forbidden() {
        throw new ForbiddenException("You cannot access this workspace");
    }

    @GetMapping("/missing")
    void missing() {
        throw new ResourceNotFoundException("Workspace was not found");
    }

    @GetMapping("/conflict")
    void conflict() {
        throw new ConflictException("The resource was updated by someone else");
    }

    @GetMapping("/conflict-with-revision")
    void conflictWithRevision() {
        throw new RevisionConflict(7L);
    }

    @GetMapping("/unsupported-file")
    void unsupportedFile() {
        throw new UnsupportedFileTypeException("File type is not supported");
    }

    @GetMapping("/too-large")
    void tooLarge() {
        throw new MaxUploadSizeExceededException(1024);
    }

    @GetMapping("/boom")
    void boom() {
        throw new IllegalStateException("db password=super-secret");
    }

    /** A conflict that carries a structured member, the way a module's own subclass would. */
    static final class RevisionConflict extends ConflictException {
        RevisionConflict(long currentRevision) {
            super("The resource was updated by someone else", Map.of("currentRevision", currentRevision));
        }
    }

    /**
     * Demonstrates RH-012: shared length limits from {@link FieldLengths} and trimming of
     * user-entered text at the API boundary via {@link Normalize#trim(String)}. {@code name}
     * mirrors a required short identifier, {@code title} an optional longer one.
     */
    public record NameBody(
            @NotBlank @Size(max = FieldLengths.NAME_MAX) String name,
            @Size(max = FieldLengths.TITLE_MAX) String title
    ) {
        public NameBody {
            name = Normalize.trim(name);
            title = Normalize.trim(title);
        }
    }

}
