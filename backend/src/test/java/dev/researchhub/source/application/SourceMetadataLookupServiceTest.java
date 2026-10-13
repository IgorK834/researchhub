package dev.researchhub.source.application;

import dev.researchhub.shared.error.*;
import dev.researchhub.workspace.application.WorkspaceAuthorizationService;
import java.util.*;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class SourceMetadataLookupServiceTest {
    final WorkspaceAuthorizationService authorization=mock(WorkspaceAuthorizationService.class);
    final SourceService sources=mock(SourceService.class);
    final BibliographicLookup lookup=mock(BibliographicLookup.class);
    final SourceMetadataLookupService service=new SourceMetadataLookupService(authorization,sources,lookup);
    final UUID workspace=UUID.randomUUID(),caller=UUID.randomUUID(),source=UUID.randomUUID();

    @Test void returnsCrossrefSuggestionWithoutInvokingAnySourceWrite() {
        var metadata=new SourceBibliography("Paper",List.of("Smith, Jane"),2025,"10.1234/abc","Journal",null,"Smith2025");
        when(lookup.available()).thenReturn(true);when(lookup.lookup("10.1234/abc")).thenReturn(Optional.of(metadata));
        var result=service.lookup(workspace,caller,source,"https://doi.org/10.1234/ABC");
        assertEquals("crossref",result.origin());assertEquals(metadata,result.bibliography());
        verify(authorization,times(2)).requireContentEditor(workspace,caller);
        verify(sources,times(2)).findOne(workspace,caller,source);
        verifyNoMoreInteractions(sources);
    }

    @Test void validatesAvailabilityAndUnknownDoiBeforePublishingSuggestion() {
        assertEquals(ApiErrorCode.VALIDATION_FAILED,assertThrows(ApiException.class,
            ()->service.lookup(workspace,caller,source,"not a doi")).code());
        when(lookup.available()).thenReturn(false);
        assertEquals(ApiErrorCode.METADATA_LOOKUP_UNAVAILABLE,assertThrows(ApiException.class,
            ()->service.lookup(workspace,caller,source,"10.1234/abc")).code());
        when(lookup.available()).thenReturn(true);when(lookup.lookup("10.1234/abc")).thenReturn(Optional.empty());
        assertThrows(ResourceNotFoundException.class,()->service.lookup(workspace,caller,source,"10.1234/abc"));
    }
}
