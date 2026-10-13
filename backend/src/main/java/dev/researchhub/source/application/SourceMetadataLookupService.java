package dev.researchhub.source.application;

import dev.researchhub.shared.error.*;
import dev.researchhub.source.domain.BibliographicMetadata;
import dev.researchhub.workspace.application.WorkspaceAuthorizationService;
import java.util.*;
import org.springframework.stereotype.Service;

@Service
public class SourceMetadataLookupService {
    private final WorkspaceAuthorizationService authorization;
    private final SourceService sources;
    private final BibliographicLookup lookup;

    public SourceMetadataLookupService(WorkspaceAuthorizationService authorization,SourceService sources,BibliographicLookup lookup) {
        this.authorization=authorization;this.sources=sources;this.lookup=lookup;
    }

    public BibliographicSuggestion lookup(UUID workspaceId,UUID callerId,UUID sourceId,String suppliedDoi) {
        authorization.requireContentEditor(workspaceId,callerId);
        sources.findOne(workspaceId,callerId,sourceId);
        String doi;
        try { doi=new BibliographicMetadata(null,List.of(),null,suppliedDoi,null,null,null).doi(); }
        catch(IllegalArgumentException invalid) { throw new ApiException(ApiErrorCode.VALIDATION_FAILED,invalid.getMessage()); }
        if(doi==null)throw new ApiException(ApiErrorCode.VALIDATION_FAILED,"DOI is required");
        if(!lookup.available())throw new ApiException(ApiErrorCode.METADATA_LOOKUP_UNAVAILABLE,
            "Bibliographic metadata lookup is not configured on this server");
        var suggestion=lookup.lookup(doi).orElseThrow(() -> new ResourceNotFoundException("No bibliographic metadata was found for this DOI"));
        // Provider I/O has no transaction and no write. Recheck before returning externally-derived data.
        authorization.requireContentEditor(workspaceId,callerId);
        sources.findOne(workspaceId,callerId,sourceId);
        return new BibliographicSuggestion("crossref",suggestion);
    }
}
