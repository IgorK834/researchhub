package dev.researchhub.audit.api;

import dev.researchhub.audit.application.AuditExportService;
import dev.researchhub.auth.application.CurrentUserResolver;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.servlet.mvc.method.annotation.StreamingResponseBody;
import java.util.UUID;

@RestController
@RequestMapping("/api/workspaces/{workspaceId}/audit/export")
public class AuditExportController {
    private final AuditExportService exports;
    private final CurrentUserResolver users;
    public AuditExportController(AuditExportService exports,CurrentUserResolver users) { this.exports=exports; this.users=users; }
    @GetMapping
    public ResponseEntity<StreamingResponseBody> export(@PathVariable UUID workspaceId,@RequestParam(defaultValue="json") String format) {
        var ticket=exports.prepare(workspaceId,users.requireCurrentUser().id(),format);
        return ResponseEntity.ok().header("Cache-Control","private, no-store")
            .header("Content-Disposition","attachment; filename=\"audit-"+ticket.id()+"."+format+"\"")
            .contentType(org.springframework.http.MediaType.parseMediaType(format.equals("csv") ? "text/csv;charset=UTF-8" : "application/json"))
            .body(output->exports.stream(ticket,output));
    }
}
