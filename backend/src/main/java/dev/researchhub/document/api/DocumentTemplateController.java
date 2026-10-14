package dev.researchhub.document.api;

import dev.researchhub.auth.application.CurrentUserResolver;
import dev.researchhub.document.application.*;
import dev.researchhub.document.application.DocumentTemplateContracts.*;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;
import tools.jackson.databind.ObjectMapper;
import java.util.*;

@RestController
@RequestMapping("/api/workspaces/{workspaceId}")
public class DocumentTemplateController {
    private final DocumentTemplateService templates;
    private final CurrentUserResolver users;
    private final ObjectMapper json;
    public DocumentTemplateController(DocumentTemplateService templates,CurrentUserResolver users,ObjectMapper json){this.templates=templates;this.users=users;this.json=json;}
    @GetMapping("/document-templates")
    ResponseEntity<List<Template>> list(@PathVariable UUID workspaceId,@RequestParam(defaultValue="en")String locale){
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(templates.list(workspaceId,users.requireCurrentUser().id(),locale));
    }
    @PostMapping("/documents/from-template")
    ResponseEntity<DocumentResponse> create(@PathVariable UUID workspaceId,@RequestBody Create request){
        return ResponseEntity.status(HttpStatus.CREATED).cacheControl(CacheControl.noStore())
            .body(DocumentResponse.from(templates.create(workspaceId,users.requireCurrentUser().id(),request),json));
    }
    @GetMapping("/documents/{documentId}/template-origin")
    ResponseEntity<Origin> origin(@PathVariable UUID workspaceId,@PathVariable UUID documentId){
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(templates.origin(workspaceId,users.requireCurrentUser().id(),documentId));
    }
}
