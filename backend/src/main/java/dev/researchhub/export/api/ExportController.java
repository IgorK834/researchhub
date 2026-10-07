package dev.researchhub.export.api;

import dev.researchhub.auth.application.CurrentUserResolver;
import dev.researchhub.export.application.*;
import dev.researchhub.export.domain.*;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.nio.charset.StandardCharsets;
import java.net.URI;
import java.util.UUID;
import org.springframework.context.annotation.Profile;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;

@RestController
@Profile("local")
@RequestMapping("/api/workspaces/{workspaceId}/documents/{documentId}/exports")
public class ExportController {
    public record Request(@NotNull ExportFormat format,@Min(1) long revision) {}
    private final ExportService exports;
    private final CurrentUserResolver users;
    public ExportController(ExportService exports,CurrentUserResolver users) { this.exports=exports;this.users=users; }
    @PostMapping
    ResponseEntity<ExportJob> create(@PathVariable UUID workspaceId,@PathVariable UUID documentId,@Valid @RequestBody Request input) {
        var job=exports.enqueue(workspaceId,users.requireCurrentUser().id(),documentId,input.format(),input.revision());
        return ResponseEntity.accepted().location(URI.create(path(workspaceId,documentId,job.id())))
            .cacheControl(CacheControl.noStore()).body(job);
    }
    @GetMapping("/{jobId}")
    ResponseEntity<ExportJob> status(@PathVariable UUID workspaceId,@PathVariable UUID documentId,@PathVariable UUID jobId) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(exports.find(workspaceId,users.requireCurrentUser().id(),documentId,jobId));
    }
    @GetMapping("/{jobId}/representation")
    ResponseEntity<Report> representation(@PathVariable UUID workspaceId,@PathVariable UUID documentId,@PathVariable UUID jobId) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(exports.report(workspaceId,users.requireCurrentUser().id(),documentId,jobId));
    }
    @GetMapping("/{jobId}/download")
    ResponseEntity<byte[]> download(@PathVariable UUID workspaceId,@PathVariable UUID documentId,@PathVariable UUID jobId) {
        var download=exports.download(workspaceId,users.requireCurrentUser().id(),documentId,jobId);
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).contentType(MediaType.parseMediaType(download.job().format().mediaType()))
            .contentLength(download.bytes().length).header(HttpHeaders.CONTENT_DISPOSITION,
                ContentDisposition.attachment().filename(download.job().filename(),StandardCharsets.UTF_8).build().toString())
            .header("X-Content-Type-Options","nosniff").body(download.bytes());
    }
    private static String path(UUID workspace,UUID document,UUID job) { return "/api/workspaces/"+workspace+"/documents/"+document+"/exports/"+job; }
}
