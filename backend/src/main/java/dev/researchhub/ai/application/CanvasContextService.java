package dev.researchhub.ai.application;

import dev.researchhub.ai.application.CanvasContracts.*;
import dev.researchhub.document.application.CanvasTargets.*;
import dev.researchhub.document.application.*;
import dev.researchhub.document.application.CanvasPositionResolver;
import dev.researchhub.analysis.application.AnalysisEvidenceService;
import dev.researchhub.source.application.SourceService;
import dev.researchhub.workspace.application.WorkspaceAuthorizationService;
import dev.researchhub.shared.error.*;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.ObjectMapper;
import java.time.Clock;
import java.util.*;

@Service
public class CanvasContextService {
    private final DocumentService documents;private final List<DocumentSnapshotState> states;
    private final CanvasPositionResolver resolver;private final CanvasContextStore store;
    private final WorkspaceAuthorizationService access;private final SourceService sources;
    private final SourceRetrievalService retrieval;private final AnalysisEvidenceService analyses;
    private final ObjectMapper json;private final Clock clock;
    public CanvasContextService(DocumentService documents,List<DocumentSnapshotState> states,CanvasPositionResolver resolver,
            CanvasContextStore store,WorkspaceAuthorizationService access,SourceService sources,SourceRetrievalService retrieval,
            AnalysisEvidenceService analyses,ObjectMapper json,Clock clock) {
        this.documents=documents;this.states=states;this.resolver=resolver;this.store=store;this.access=access;
        this.sources=sources;this.retrieval=retrieval;this.analyses=analyses;this.json=json;this.clock=clock;
    }
    @Transactional
    public Context capture(UUID workspace,UUID document,UUID caller,Capture request) {
        var saved=documents.lockForContext(workspace,caller,document);
        if(!access.permitsSystemContentMaintenance(workspace) || saved.summary().archivedAt()!=null)
            throw new ConflictException("New AI contexts require an active workspace and document");
        validate(request);
        String hash=CanvasDocumentTarget.hash(json.writeValueAsString(request));
        var replay=store.replay(workspace,document,caller,request.clientRequestId());
        if(replay.isPresent()) {
            if(!hash.equals(replay.get().requestHash())) throw new ConflictException("Context request identity was reused with a different payload");
            authorize(workspace,caller,replay.get().context().snapshot());return replay.get().context();
        }
        if(request.revision()!=saved.summary().revision()) throw CanvasDocumentTarget.stale("NOT_SYNCHRONIZED");
        var state=state(document);
        if(state.isEmpty() && states.stream().anyMatch(s -> s.requiresRealtime(document))) throw CanvasDocumentTarget.stale("NOT_SYNCHRONIZED");
        Target target=request.target();
        Capture pinned=request;
        if(state.isPresent()) {
            var current=state.get();
            Resolution resolved;
            if(request.epoch()==null && request.sequence()==null && request.relative()==null && request.stateVector()==null) {
                // Readers use a saved projection without entering an editing room. Pin it server-side.
                new CanvasDocumentTarget(json).capture(saved.content(),target);
                resolved=resolver.pin(current,target);
                if(resolved.relative()==null) throw CanvasDocumentTarget.stale("TARGET_STALE");
                pinned=new Capture(request.schemaVersion(),request.clientRequestId(),request.revision(),current.epoch(),current.sequence(),null,resolved.relative(),target);
            } else {
                if(request.epoch()==null || request.sequence()==null || request.epoch()!=current.epoch() || request.sequence()!=current.sequence()
                        || request.relative()==null || request.stateVector()==null) throw CanvasDocumentTarget.stale("NOT_SYNCHRONIZED");
                resolved=resolver.resolve(current,request.relative(),request.stateVector());
            }
            if(!resolved.start().equals(target.start()) || !resolved.end().equals(target.end())) throw CanvasDocumentTarget.stale("TARGET_STALE");
        } else if(request.epoch()!=null || request.sequence()!=null || request.relative()!=null || request.stateVector()!=null)
            throw CanvasDocumentTarget.stale("NOT_SYNCHRONIZED");
        var snapshot=new CanvasDocumentTarget(json).capture(saved.content(),target);
        if(!snapshot.target().equals(target)) throw CanvasDocumentTarget.stale("TARGET_STALE");
        authorize(workspace,caller,snapshot);
        // Read authorization again before publishing a new durable context.
        access.requireContentReader(workspace,caller);
        var context=new Context("1.0",UUID.randomUUID(),workspace,document,saved.summary().revision(),pinned.epoch(),pinned.sequence(),snapshot,clock.instant());
        store.insert(caller,hash,pinned,context);return context;
    }
    @Transactional
    public Context find(UUID workspace,UUID document,UUID caller,UUID id) {
        documents.findOne(workspace,caller,document);
        var context=stored(workspace,document,id).context();authorize(workspace,caller,context.snapshot());return context;
    }
    /** Conditional resolution for later operations. A read of history never silently retargets it. */
    @Transactional
    public Snapshot resolve(UUID workspace,UUID document,UUID caller,UUID id) {
        var saved=documents.lockForContext(workspace,caller,document);
        var stored=stored(workspace,document,id);var context=stored.context();var target=context.snapshot().target();
        var current=state(document);
        if(context.epoch()!=null) {
            if(current.isEmpty() || current.get().epoch()!=context.epoch()) throw CanvasDocumentTarget.stale("TARGET_STALE");
            var resolved=resolver.resolve(current.get(),stored.request().relative(),null);
            if(!sameBlock(target.start(),resolved.start()) || !sameBlock(target.end(),resolved.end())) throw CanvasDocumentTarget.stale("TARGET_STALE");
            target=new Target(target.kind(),resolved.start(),resolved.end(),target.hash());
        } else if(current.isPresent() || saved.summary().revision()!=context.revision()) {
            // Known identities permit unrelated legacy saves; revision-only paths cannot be rebased.
            if(current.isPresent() || target.start().blockId()==null || target.end().blockId()==null) throw CanvasDocumentTarget.stale("TARGET_STALE");
        }
        Snapshot snapshot;
        try {snapshot=new CanvasDocumentTarget(json).capture(saved.content(),target);}
        catch(ApiException error) {
            // A previously valid range can collapse, disappear or split a new surrogate after edits.
            if(error.code()==ApiErrorCode.VALIDATION_FAILED)throw CanvasDocumentTarget.stale("TARGET_STALE");
            throw error;
        }
        authorize(workspace,caller,snapshot);return snapshot;
    }
    private static boolean sameBlock(Endpoint old,Endpoint current) {
        return old.blockId()!=null ? old.blockId().equals(current.blockId()) : old.path().equals(current.path());
    }
    private Optional<DocumentSnapshotState.State> state(UUID document) { return states.stream().map(s -> s.snapshotState(document)).flatMap(Optional::stream).findFirst(); }
    private CanvasContextStore.Stored stored(UUID workspace,UUID document,UUID id) {
        return store.find(workspace,document,id).orElseThrow(() -> new ResourceNotFoundException("Document context was not found"));
    }
    private void authorize(UUID workspace,UUID caller,Snapshot snapshot) {
        for(var ref:snapshot.sources()) {
            if(ref.sourceVersionId()!=null) sources.findVersion(workspace,caller,ref.sourceId(),ref.sourceVersionId());
            else sources.findOne(workspace,caller,ref.sourceId());
            if(ref.chunkId()!=null) {
                if(ref.processingVersion()==null) throw new ApiException(ApiErrorCode.VALIDATION_FAILED,"Source evidence requires retrieval provenance");
                retrieval.chunk(workspace,ref.sourceId(),ref.sourceVersionId(),caller,ref.chunkId(),ref.processingVersion());
            }
        }
        analyses.resolve(workspace,caller,snapshot.analyses().stream().map(r -> new AnalysisEvidenceService.Reference(r.analysisId(),r.executionId(),r.outputId())).toList());
    }
    private void validate(Capture request) {
        if(request==null || !"1.0".equals(request.schemaVersion()) || request.clientRequestId()==null || request.revision()<1 || request.target()==null
                || request.epoch()!=null && request.epoch()<0 || request.sequence()!=null && request.sequence()<0
                || request.stateVector()!=null && request.stateVector().length()>65536
                || request.relative()!=null && (request.relative().start()==null || request.relative().end()==null
                    || request.relative().start().length()>1024 || request.relative().end().length()>1024))
            throw new ApiException(ApiErrorCode.VALIDATION_FAILED,"Invalid canvas context request");
    }
}
