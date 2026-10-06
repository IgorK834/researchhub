package dev.researchhub.document.api;

import dev.researchhub.auth.application.CurrentUserResolver;
import dev.researchhub.document.application.DocumentProvenance;
import org.springframework.context.annotation.Profile;
import org.springframework.web.bind.annotation.*;
import java.util.*;

@RestController
@Profile("local")
@RequestMapping("/api/workspaces/{workspace}/documents/{document}/blocks/{block}/provenance")
public class DocumentProvenanceController {
    private final DocumentProvenance service;
    private final CurrentUserResolver users;
    public DocumentProvenanceController(DocumentProvenance service,CurrentUserResolver users) { this.service=service; this.users=users; }
    @GetMapping public List<DocumentProvenance.Operation> inspect(@PathVariable UUID workspace,@PathVariable UUID document,@PathVariable UUID block) {
        return service.inspect(workspace,users.requireCurrentUser().id(),document,block);
    }
}
