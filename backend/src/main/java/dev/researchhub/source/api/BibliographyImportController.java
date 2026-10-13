package dev.researchhub.source.api;

import dev.researchhub.auth.application.CurrentUserResolver;
import dev.researchhub.shared.error.ApiErrorCode;
import dev.researchhub.shared.error.ApiException;
import dev.researchhub.source.application.BibliographyImportContracts.*;
import dev.researchhub.source.application.BibliographyImportService;
import dev.researchhub.security.application.CostCategory;
import dev.researchhub.security.application.CostlyOperation;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RequestPart;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.util.Locale;
import java.util.UUID;

@RestController
@RequestMapping("/api/workspaces/{workspaceId}/bibliography/imports")
public class BibliographyImportController {
    private final BibliographyImportService imports;
    private final CurrentUserResolver users;

    public BibliographyImportController(BibliographyImportService imports, CurrentUserResolver users) {
        this.imports = imports;
        this.users = users;
    }

    @PostMapping(consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @CostlyOperation(value = CostCategory.BIBLIOGRAPHY_IMPORT, access = CostlyOperation.Access.EDIT)
    ResponseEntity<Preview> preview(@PathVariable UUID workspaceId,
                                    @RequestPart(name = "file", required = false) MultipartFile file,
                                    @RequestParam(required = false) String format,
                                    @RequestParam(defaultValue = "GENERIC") String origin) {
        if (file == null) throw invalid("A file part named 'file' is required");
        try (InputStream content = file.getInputStream()) {
            Preview result = imports.preview(workspaceId, user(), file.getOriginalFilename(), file.getSize(),
                    enumValue(Format.class, format), enumValue(Origin.class, origin), content);
            return ResponseEntity.status(HttpStatus.CREATED).cacheControl(CacheControl.noStore()).body(result);
        } catch (IOException failed) {
            throw new UncheckedIOException("The bibliography file could not be read", failed);
        }
    }

    @GetMapping("/{importId}")
    ResponseEntity<Preview> find(@PathVariable UUID workspaceId, @PathVariable UUID importId) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(imports.find(workspaceId, user(), importId));
    }

    @GetMapping("/{importId}/result")
    ResponseEntity<Result> result(@PathVariable UUID workspaceId,@PathVariable UUID importId) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(imports.savedResult(workspaceId,user(),importId));
    }

    @PostMapping("/{importId}/confirm")
    ResponseEntity<Result> confirm(@PathVariable UUID workspaceId, @PathVariable UUID importId,
                                   @RequestBody(required = false) ConfirmRequest request) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore())
                .body(imports.confirm(workspaceId, user(), importId, request));
    }

    @DeleteMapping("/{importId}")
    ResponseEntity<Void> cancel(@PathVariable UUID workspaceId, @PathVariable UUID importId) {
        imports.cancel(workspaceId, user(), importId);
        return ResponseEntity.noContent().cacheControl(CacheControl.noStore()).build();
    }

    private UUID user() {
        return users.requireCurrentUser().id();
    }

    private static <T extends Enum<T>> T enumValue(Class<T> type, String value) {
        if (value == null || value.isBlank()) return null;
        try { return Enum.valueOf(type, value.strip().toUpperCase(Locale.ROOT)); }
        catch (IllegalArgumentException invalid) { throw invalid("Unsupported " + type.getSimpleName().toLowerCase(Locale.ROOT)); }
    }

    private static ApiException invalid(String detail) {
        return new ApiException(ApiErrorCode.VALIDATION_FAILED, detail);
    }
}
