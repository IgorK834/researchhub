package dev.researchhub.ai.application;

import dev.researchhub.workspace.application.WorkspaceAuthorizationService;
import dev.researchhub.source.application.SourceReadScope;
import dev.researchhub.shared.error.*;
import org.junit.jupiter.api.Test;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class RetrievalSearchServiceTest {
    private final WorkspaceAuthorizationService authorization = mock(WorkspaceAuthorizationService.class);
    private final SourceReadScope sources = mock(SourceReadScope.class);
    private final EmbeddingProvider embeddings = mock(EmbeddingProvider.class);
    private final RetrievalIndex index = mock(RetrievalIndex.class);
    private final RetrievalSearchService service = new RetrievalSearchService(authorization,sources,embeddings,index);
    private final UUID workspace = UUID.randomUUID(), user = UUID.randomUUID();

    @Test void authorizesBeforeEmbeddingAndRefusesSourcesOutsideWorkspace() {
        doThrow(new ResourceNotFoundException("Workspace was not found")).when(authorization).requireContentReader(workspace,user);
        assertThrows(ResourceNotFoundException.class,() -> service.search("query",workspace,null,10,user));
        verifyNoInteractions(embeddings,index,sources);
        reset(authorization);
        doThrow(new ResourceNotFoundException("Source was not found")).when(sources).requireSources(eq(workspace),eq(user),anyList());
        assertThrows(ResourceNotFoundException.class,() -> service.search("query",workspace,List.of(UUID.randomUUID()),10,user));
        assertThrows(ResourceNotFoundException.class,() -> service.search("query",workspace,Collections.singletonList(null),10,user));
        verifyNoInteractions(embeddings,index);
    }
    @Test void validatesLimitsAndTreatsEmptySelectedSourcesAsNoSources() {
        for (String query : Arrays.asList(null," ","q".repeat(2001)))
            assertThrows(ApiException.class,() -> service.search(query,workspace,null,10,user));
        for (int topK : new int[]{0,51}) assertThrows(ApiException.class,() -> service.search("query",workspace,null,topK,user));
        assertThrows(ApiException.class,() -> service.search("query",workspace,Collections.nCopies(101,UUID.randomUUID()),10,user));
        assertTrue(service.search("query",workspace,List.of(),10,user).isEmpty());
        verifyNoInteractions(embeddings,index);
    }
}
