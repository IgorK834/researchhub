package dev.researchhub.source.api;

import dev.researchhub.auth.application.CurrentUserResolver;
import dev.researchhub.source.application.BibliographyImportContracts.ItemPage;
import dev.researchhub.source.application.BibliographyImportContracts.ItemUpdate;
import dev.researchhub.source.application.BibliographyImportService;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;
import java.util.UUID;

@RestController
@RequestMapping("/api/workspaces/{workspaceId}/bibliography/items")
public class BibliographyItemController {
    private final BibliographyImportService imports;
    private final CurrentUserResolver users;
    public BibliographyItemController(BibliographyImportService imports,CurrentUserResolver users) {
        this.imports=imports;this.users=users;
    }
    @GetMapping
    ResponseEntity<ItemPage> list(@PathVariable UUID workspaceId,@RequestParam(defaultValue="0") String offset) {
        int parsed;
        try{parsed=Integer.parseInt(offset);}catch(NumberFormatException bad){throw new dev.researchhub.shared.error.ApiException(dev.researchhub.shared.error.ApiErrorCode.VALIDATION_FAILED,"Bibliography offset must be an integer");}
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(imports.items(workspaceId,users.requireCurrentUser().id(),parsed));
    }
    @PutMapping("/{itemId}")
    ResponseEntity<Void> update(@PathVariable UUID workspaceId,@PathVariable UUID itemId,@RequestBody ItemUpdate request) {
        imports.updateItem(workspaceId,users.requireCurrentUser().id(),itemId,request);
        return ResponseEntity.noContent().cacheControl(CacheControl.noStore()).build();
    }
}
