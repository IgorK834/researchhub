package dev.researchhub.document.application;

import dev.researchhub.document.application.DocumentTemplateContracts.Create;
import dev.researchhub.document.infrastructure.*;
import dev.researchhub.shared.error.ApiException;
import dev.researchhub.workspace.application.WorkspaceAuthorizationService;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.ObjectMapper;
import java.time.Clock;
import java.util.*;
import static org.mockito.Mockito.*;
import static org.junit.jupiter.api.Assertions.*;

class DocumentTemplateServiceTest {
    @Test void missingInputsNeverReachPersistenceOrAdmission() {
        var store=mock(PostgresDocumentTemplates.class);var admission=mock(DocumentCreationAdmission.class);
        var auth=mock(WorkspaceAuthorizationService.class);
        var service=new DocumentTemplateService(mock(BundledDocumentTemplates.class),store,admission,mock(DocumentService.class),mock(DocumentProvenance.class),auth,new ObjectMapper(),Clock.systemUTC());
        UUID workspace=UUID.randomUUID(),user=UUID.randomUUID(),id=UUID.randomUUID();
        for(Create request:Arrays.asList(null,new Create(null,"lab-report",1,"en","Title"),new Create(id,null,1,"en","Title"),new Create(id,"lab-report",1,"en",null),new Create(id,"lab-report",1,null,"Title")))
            assertThrows(ApiException.class,()->service.create(workspace,user,request));
        verifyNoInteractions(store,admission);verify(auth,times(5)).requireContentEditor(workspace,user);
    }
}
