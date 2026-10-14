package dev.researchhub.document.application;

import dev.researchhub.document.application.DocumentTemplateContracts.*;
import dev.researchhub.document.infrastructure.*;
import dev.researchhub.shared.error.*;
import dev.researchhub.workspace.application.WorkspaceAuthorizationService;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.ObjectMapper;
import java.time.Clock;
import java.util.*;

@Service
public class DocumentTemplateService {
    private final BundledDocumentTemplates catalog;
    private final PostgresDocumentTemplates store;
    private final DocumentCreationAdmission admission;
    private final DocumentService documents;
    private final DocumentProvenance provenance;
    private final WorkspaceAuthorizationService authorization;
    private final ObjectMapper json;
    private final Clock clock;
    public DocumentTemplateService(BundledDocumentTemplates catalog,PostgresDocumentTemplates store,DocumentCreationAdmission admission,
        DocumentService documents,DocumentProvenance provenance,WorkspaceAuthorizationService authorization,ObjectMapper json,Clock clock) {
        this.catalog=catalog;this.store=store;this.admission=admission;this.documents=documents;this.provenance=provenance;
        this.authorization=authorization;this.json=json;this.clock=clock;
    }
    public List<Template> list(UUID workspace,UUID caller,String locale) {authorization.requireContentReader(workspace,caller);return catalog.list(locale);}
    public Origin origin(UUID workspace,UUID caller,UUID document) {
        documents.findOne(workspace,caller,document);return store.origin(workspace,document).orElse(null);
    }
    @Transactional
    public DocumentDetail create(UUID workspace,UUID caller,Create request) {
        authorization.requireContentEditor(workspace,caller);
        if(request==null||request.clientRequestId()==null||request.templateId()==null||request.title()==null)
            throw new ApiException(ApiErrorCode.VALIDATION_FAILED,"A request identity, template and document title are required");
        BundledDocumentTemplates.locale(request.locale());
        String fingerprint=BundledDocumentTemplates.hash(json.writeValueAsString(new Create(request.clientRequestId(),request.templateId(),request.version(),request.locale(),request.title().strip())));
        admission.lock(workspace);
        var previous=store.receipt(workspace,caller,request.clientRequestId());
        if(previous.isPresent()) {
            if(!previous.get().requestSha256().equals(fingerprint))throw new ConflictException("This creation identity was already used with different settings");
            return documents.findOne(workspace,caller,previous.get().origin().documentId());
        }
        var template=catalog.find(request.templateId(),request.version(),request.locale());
        String content=catalog.instantiate(template,request.clientRequestId());
        var saved=documents.create(workspace,caller,new CreateDocumentCommand(request.title(),content));
        var origin=new Origin(saved.summary().id(),template.id(),template.version(),template.locale(),template.sha256(),BundledDocumentTemplates.hash(content),clock.instant().truncatedTo(java.time.temporal.ChronoUnit.MICROS));
        store.create(workspace,caller,request.clientRequestId(),fingerprint,origin);
        provenance.templateApplied(workspace,caller,saved,request.clientRequestId(),json.valueToTree(origin));
        return saved;
    }
}
