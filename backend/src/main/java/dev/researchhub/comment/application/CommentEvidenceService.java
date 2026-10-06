package dev.researchhub.comment.application;

import dev.researchhub.ai.application.EvidenceAssistanceService;
import dev.researchhub.comment.application.CommentEvidenceContracts.Suggestion;
import dev.researchhub.comment.infrastructure.PostgresCommentEvidence;
import dev.researchhub.document.application.DocumentService;
import dev.researchhub.shared.error.*;
import dev.researchhub.user.application.UserLookupService;
import dev.researchhub.workspace.application.WorkspaceAuthorizationService;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Service;
import java.time.Clock;
import java.util.List;
import java.util.UUID;

@Service
@Profile("local")
public class CommentEvidenceService {
    private final WorkspaceAuthorizationService authorization;
    private final CommentService comments;
    private final DocumentService documents;
    private final CommentAnchors anchors;
    private final EvidenceAssistanceService assistance;
    private final PostgresCommentEvidence store;
    private final CommentEvidenceWriter writer;
    private final UserLookupService users;
    private final Clock clock;
    public CommentEvidenceService(WorkspaceAuthorizationService authorization, CommentService comments, DocumentService documents,
            CommentAnchors anchors, EvidenceAssistanceService assistance, PostgresCommentEvidence store,
            CommentEvidenceWriter writer, UserLookupService users, Clock clock) {
        this.authorization=authorization; this.comments=comments; this.documents=documents; this.anchors=anchors;
        this.assistance=assistance; this.store=store; this.writer=writer; this.users=users; this.clock=clock;
    }
    public CommentContracts.Comment invoke(UUID workspace, UUID document, UUID caller, UUID commentId, UUID requestId) {
        authorization.requireAiContributor(workspace,caller);
        var comment=comments.thread(workspace,caller,document,commentId).comment();
        var existing=store.find(workspace,document,commentId,requestId).orElse(null);
        if (existing!=null) {
            if (!existing.requestedBy().equals(caller)) throw new ConflictException("This AI request id is already in use");
        } else {
            if (!"OPEN".equals(comment.status())) throw new ConflictException("Reopen this thread before requesting evidence");
            var documentState=documents.findOne(workspace,caller,document);
            if (documentState.summary().archivedAt()!=null) throw new ConflictException("The document is archived");
            var claim=anchors.claim(documentState.content(),comment.anchor().id());
            var name=users.findAllByIds(List.of(caller)).stream().findFirst().orElseThrow(() -> new ResourceNotFoundException("User was not found")).displayName();
            var result=assistance.find(workspace,caller,claim);
            writer.publish(workspace,document,caller,new Suggestion(requestId,commentId,"AI_EVIDENCE",caller,name,claim,result,clock.instant(),List.of()));
        }
        return comments.thread(workspace,caller,document,commentId).comment();
    }
}
