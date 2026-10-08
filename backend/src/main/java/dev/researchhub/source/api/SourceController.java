package dev.researchhub.source.api;

import dev.researchhub.auth.application.CurrentUserResolver;
import dev.researchhub.shared.error.ApiErrorCode;
import dev.researchhub.shared.error.ApiException;
import dev.researchhub.source.application.SourceContent;
import dev.researchhub.source.application.SourceExtractionService;
import dev.researchhub.processing.application.SourceExtraction;
import dev.researchhub.source.application.SourceService;
import dev.researchhub.source.application.SourceBibliography;
import dev.researchhub.source.application.SourceOrganization;
import dev.researchhub.source.application.SourceLibraryFacets;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import dev.researchhub.source.application.UploadSourceCommand;
import org.springframework.core.io.InputStreamResource;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestPart;
import org.springframework.web.bind.annotation.RequestParam;
import dev.researchhub.source.application.ExtractionRun;
import dev.researchhub.source.application.SourceLocation;
import dev.researchhub.shared.error.UnsupportedFileTypeException;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.UUID;

/** Workspace-scoped upload and read endpoints for immutable research source files. */
@RestController
@RequestMapping("/api/workspaces/{workspaceId}/sources")
public class SourceController {

    private final SourceExtractionService extractions;
    private final dev.researchhub.source.application.SourceProcessingProgress progress;
    private final SourceService sources;
    private final CurrentUserResolver currentUserResolver;

    public SourceController(SourceService sources, CurrentUserResolver currentUserResolver, SourceExtractionService extractions,
                            dev.researchhub.source.application.SourceProcessingProgress progress) {
        this.progress = progress;
        this.extractions = extractions;
        this.sources = sources;
        this.currentUserResolver = currentUserResolver;
    }

    @PostMapping(consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    ResponseEntity<SourceResponse> upload(@PathVariable UUID workspaceId,
                                          @RequestPart(name = "file", required = false) MultipartFile file) {
        if (file == null) {
            throw new ApiException(ApiErrorCode.VALIDATION_FAILED, "A file part named 'file' is required");
        }

        try (InputStream content = file.getInputStream()) {
            SourceResponse uploaded = SourceResponse.from(sources.upload(workspaceId, currentUserId(),
                    new UploadSourceCommand(file.getOriginalFilename(), file.getContentType(), file.getSize(),
                            content)));
            return ResponseEntity.status(HttpStatus.CREATED).body(uploaded);
        } catch (IOException failure) {
            throw new UncheckedIOException("The uploaded file could not be read", failure);
        }
    }

    @GetMapping
    List<SourceResponse> list(@PathVariable UUID workspaceId) {
        return sources.list(workspaceId, currentUserId()).stream().map(SourceResponse::from).toList();
    }

    public record SearchPage(List<SourceResponse> items, long totalElements, int page, int size, boolean hasNext) {}

    @GetMapping("/search")
    ResponseEntity<SearchPage> search(@PathVariable UUID workspaceId,
            @RequestParam(defaultValue = "") String query, @RequestParam(defaultValue = "") String type,
            @RequestParam(defaultValue = "") String uploader, @RequestParam(defaultValue = "") String status,
            @RequestParam(defaultValue = "") String tag, @RequestParam(defaultValue = "") String collection,
            @RequestParam(defaultValue = "0") String page, @RequestParam(defaultValue = "30") String size) {
        var result = sources.search(workspaceId, currentUserId(), query, type, uploader, status, tag, collection, page, size);
        return ResponseEntity.ok().header(HttpHeaders.CACHE_CONTROL, "private, no-store")
                .body(new SearchPage(result.items().stream().map(SourceResponse::from).toList(), result.totalElements(),
                        result.page(), result.size(), result.hasNext()));
    }

    @GetMapping("/facets")
    ResponseEntity<SourceLibraryFacets> facets(@PathVariable UUID workspaceId) {
        return ResponseEntity.ok().header(HttpHeaders.CACHE_CONTROL, "private, no-store")
                .body(sources.facets(workspaceId, currentUserId()));
    }

    @PutMapping("/{sourceId}/bibliography")
    SourceResponse bibliography(@PathVariable UUID workspaceId, @PathVariable UUID sourceId,
                                @RequestBody SourceBibliography metadata) {
        return SourceResponse.from(sources.updateBibliography(workspaceId, currentUserId(), sourceId, metadata));
    }

    @PutMapping("/{sourceId}/organization")
    SourceResponse organization(@PathVariable UUID workspaceId, @PathVariable UUID sourceId,
                                @RequestBody SourceOrganization organization) {
        return SourceResponse.from(sources.organize(workspaceId, currentUserId(), sourceId, organization));
    }

    @GetMapping("/{sourceId}")
    SourceResponse get(@PathVariable UUID workspaceId, @PathVariable UUID sourceId) {
        return SourceResponse.from(sources.findOne(workspaceId, currentUserId(), sourceId));
    }

    @PostMapping(path = "/{sourceId}/versions", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    ResponseEntity<SourceResponse> replace(@PathVariable UUID workspaceId, @PathVariable UUID sourceId,
                                           @RequestPart(name = "file", required = false) MultipartFile file) {
        if (file == null) throw new ApiException(ApiErrorCode.VALIDATION_FAILED, "A file part named 'file' is required");
        try (InputStream content = file.getInputStream()) {
            return ResponseEntity.status(HttpStatus.CREATED).body(SourceResponse.from(sources.replace(workspaceId,
                    currentUserId(), sourceId, new UploadSourceCommand(file.getOriginalFilename(),
                            file.getContentType(), file.getSize(), content))));
        } catch (IOException failure) {
            throw new UncheckedIOException("The uploaded file could not be read", failure);
        }
    }

    @GetMapping("/{sourceId}/versions")
    List<SourceVersionResponse> versions(@PathVariable UUID workspaceId, @PathVariable UUID sourceId) {
        return sources.versions(workspaceId, currentUserId(), sourceId).stream()
                .map(SourceVersionResponse::from).toList();
    }

    @GetMapping("/{sourceId}/versions/{versionId}")
    SourceVersionResponse version(@PathVariable UUID workspaceId, @PathVariable UUID sourceId,
                                  @PathVariable UUID versionId) {
        return SourceVersionResponse.from(sources.findVersion(workspaceId, currentUserId(), sourceId, versionId));
    }

    @GetMapping("/{sourceId}/versions/{versionId}/content")
    ResponseEntity<InputStreamResource> versionContent(@PathVariable UUID workspaceId, @PathVariable UUID sourceId,
                                                       @PathVariable UUID versionId) {
        var opened = sources.openVersionContent(workspaceId, currentUserId(), sourceId, versionId);
        ContentDisposition disposition = ContentDisposition.attachment()
                .filename(opened.version().originalFilename(), StandardCharsets.UTF_8).build();
        return ResponseEntity.ok().contentType(MediaType.parseMediaType(opened.version().mediaType()))
                .contentLength(opened.version().sizeBytes())
                .header(HttpHeaders.CONTENT_DISPOSITION, disposition.toString())
                .header(HttpHeaders.CACHE_CONTROL, "private, no-store")
                .header("X-Content-Type-Options", "nosniff")
                .body(new InputStreamResource(opened.content()));
    }

    @GetMapping("/{sourceId}/extraction")
    ResponseEntity<SourceExtraction> extraction(@PathVariable UUID workspaceId, @PathVariable UUID sourceId) {
        SourceExtraction extraction = extractions.find(workspaceId, sourceId, currentUserId());
        return extraction == null ? ResponseEntity.noContent().header(HttpHeaders.CACHE_CONTROL, "private, no-store").build()
                : ResponseEntity.ok().header(HttpHeaders.CACHE_CONTROL, "private, no-store").body(extraction);
    }

    @GetMapping("/{sourceId}/processing")
    ResponseEntity<dev.researchhub.source.application.SourceProcessingProgress.Progress> processing(@PathVariable UUID workspaceId, @PathVariable UUID sourceId) {
        var result = progress.find(workspaceId, sourceId, currentUserId());
        return result == null ? ResponseEntity.noContent().header(HttpHeaders.CACHE_CONTROL, "private, no-store").build()
            : ResponseEntity.ok().header(HttpHeaders.CACHE_CONTROL, "private, no-store").body(result);
    }

    @PostMapping("/{sourceId}/reprocess")
    ResponseEntity<SourceResponse> reprocess(@PathVariable UUID workspaceId, @PathVariable UUID sourceId) {
        return ResponseEntity.accepted().body(SourceResponse.from(sources.reprocess(workspaceId, currentUserId(), sourceId)));
    }

    @GetMapping("/{sourceId}/extraction/runs")
    ResponseEntity<List<ExtractionRun>> runs(@PathVariable UUID workspaceId, @PathVariable UUID sourceId) {
        return ResponseEntity.ok().header(HttpHeaders.CACHE_CONTROL, "private, no-store")
                .body(extractions.runs(workspaceId, sourceId, currentUserId()));
    }

    @GetMapping("/{sourceId}/locations/{unitId}")
    ResponseEntity<SourceLocation> location(@PathVariable UUID workspaceId, @PathVariable UUID sourceId, @PathVariable String unitId) {
        return ResponseEntity.ok().header(HttpHeaders.CACHE_CONTROL, "private, no-store")
                .body(extractions.location(workspaceId, sourceId, currentUserId(), unitId, null));
    }

    @GetMapping("/{sourceId}/locations")
    ResponseEntity<SourceLocation> pageLocation(@PathVariable UUID workspaceId, @PathVariable UUID sourceId,
                                              @RequestParam Integer pageNumber) {
        return ResponseEntity.ok().header(HttpHeaders.CACHE_CONTROL, "private, no-store")
                .body(extractions.location(workspaceId, sourceId, currentUserId(), null, pageNumber));
    }

    @GetMapping("/{sourceId}/preview")
    ResponseEntity<InputStreamResource> preview(@PathVariable UUID workspaceId, @PathVariable UUID sourceId) {
        var source = sources.findOne(workspaceId, currentUserId(), sourceId);
        if (!"PDF".equals(source.sourceType())) throw new UnsupportedFileTypeException("Browser preview is available for PDF sources");
        SourceContent opened = sources.openContent(workspaceId, currentUserId(), sourceId);
        return ResponseEntity.ok().contentType(MediaType.APPLICATION_PDF).contentLength(opened.source().sizeBytes())
                .header(HttpHeaders.CONTENT_DISPOSITION, ContentDisposition.inline().filename(opened.source().displayName(), StandardCharsets.UTF_8).build().toString())
                .header(HttpHeaders.CACHE_CONTROL, "private, no-store").header("X-Content-Type-Options", "nosniff")
                .header("Content-Security-Policy", "sandbox")
                .body(new InputStreamResource(opened.content()));
    }

    @GetMapping("/{sourceId}/content")
    ResponseEntity<InputStreamResource> content(@PathVariable UUID workspaceId, @PathVariable UUID sourceId) {
        SourceContent opened = sources.openContent(workspaceId, currentUserId(), sourceId);
        ContentDisposition disposition = ContentDisposition.attachment()
                .filename(opened.source().displayName(), StandardCharsets.UTF_8)
                .build();

        return ResponseEntity.ok()
                .contentType(MediaType.parseMediaType(opened.source().mediaType()))
                .contentLength(opened.source().sizeBytes())
                .header(HttpHeaders.CONTENT_DISPOSITION, disposition.toString())
                .header(HttpHeaders.CACHE_CONTROL, "private, no-store")
                .header("X-Content-Type-Options", "nosniff")
                .body(new InputStreamResource(opened.content()));
    }

    private UUID currentUserId() {
        return currentUserResolver.requireCurrentUser().id();
    }

}
