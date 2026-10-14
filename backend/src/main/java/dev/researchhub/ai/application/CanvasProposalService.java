package dev.researchhub.ai.application;

import dev.researchhub.ai.application.CanvasConversationContracts.*;
import dev.researchhub.ai.application.CanvasProposalContracts.*;
import dev.researchhub.ai.application.GenerationContracts.*;
import dev.researchhub.ai.infrastructure.PostgresCanvasProposalStore;
import dev.researchhub.document.application.*;
import dev.researchhub.shared.error.*;
import dev.researchhub.source.application.*;
import dev.researchhub.workspace.application.WorkspaceAuthorizationService;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import tools.jackson.databind.ObjectMapper;

import java.time.Clock;
import java.util.*;

@Service
public class CanvasProposalService {
    @org.springframework.beans.factory.annotation.Autowired private dev.researchhub.ai.observability.CanvasWorkflowObservation observation=dev.researchhub.ai.observability.CanvasWorkflowObservation.none();
    private final PostgresCanvasProposalStore store;
    private final DocumentService documents;
    private final CanvasContextService contexts;
    private final WorkspaceAuthorizationService access;
    private final SourceReadScope scope;
    private final SourceService sources;
    private final SourceRetrievalService retrieval;
    private final ModelGateway gateway;
    private final GroundedContextBuilder grounded;
    private final ContextProperties budgets;
    private final CanvasTurnStore turns;
    private final ObjectMapper json;
    private final Clock clock;
    @org.springframework.beans.factory.annotation.Autowired private DocumentProvenance provenance;
    @org.springframework.beans.factory.annotation.Autowired private dev.researchhub.analysis.application.AnalysisDocumentReferences calculationReferences;
    private final String instruction;

    public CanvasProposalService(
            PostgresCanvasProposalStore store,
            DocumentService documents,
            CanvasContextService contexts,
            WorkspaceAuthorizationService access,
            SourceReadScope scope,
            SourceService sources,
            SourceRetrievalService retrieval,
            ModelGateway gateway,
            GroundedContextBuilder grounded,
            ContextProperties budgets,
            CanvasTurnStore turns,
            ObjectMapper json,
            Clock clock)
            throws java.io.IOException {
        this.store = store;
        this.documents = documents;
        this.contexts = contexts;
        this.access = access;
        this.scope = scope;
        this.sources = sources;
        this.retrieval = retrieval;
        this.gateway = gateway;
        this.grounded = grounded;
        this.budgets = budgets;
        this.turns = turns;
        this.json = json;
        this.clock = clock;
        this.instruction = GenerationFeature.loadInstruction("canvas-edit-v2.txt");
    }

    public Proposal generate(Work work, Memory memory) {
        access.requireContentEditor(work.workspaceId(), work.callerId());
        Proposal previous =
                work.request().targetProposalId() == null
                        ? null
                        : store.reference(
                                        work.workspaceId(),
                                        work.documentId(),
                                        work.request().targetProposalId())
                                .orElse(null);
        UUID contextId =
                previous != null && "PENDING".equals(previous.state())
                        ? previous.contextId()
                        : work.request().contextId();
        if (previous != null && "ACCEPTED".equals(previous.state()))
            contextId = captureAccepted(work, previous);
        var target =
                contexts.resolve(work.workspaceId(), work.documentId(), work.callerId(), contextId)
                        .target();
        String lower = work.request().instruction().toLowerCase(Locale.ROOT);
        Mode mode =
                target.kind() == CanvasTargets.Kind.CARET
                                || lower.matches(
                                        "(?s).*(\\badd\\b|\\binsert\\b|\\bappend\\b|\\bdodaj\\b|\\bwstaw\\b).*")
                        ? Mode.INSERT_AT_ANCHOR
                        : Mode.REPLACE_RANGE;
        if (previous != null && "PENDING".equals(previous.state())) {
            mode = previous.mode();
        }
        var document = documents.findOne(work.workspaceId(), work.callerId(), work.documentId());
        // Validate the edit shape before paying for inference.
        new CanvasEdit(json)
                .plan(
                        document.content(),
                        target,
                        mode == Mode.REPLACE_RANGE,
                        List.of("preview"),
                        json.createArrayNode(),
                        work.turnId());
        scope.requireSourceVersions(
                work.workspaceId(), work.callerId(), work.request().scope().sourceVersionIds());
        if(!work.request().scope().sourceVersionIds().isEmpty())turns.admitRetrieval(work);
        long retrievalStart=System.nanoTime();
        var chunks = new ArrayList<RetrievalChunk>();
        for (UUID id : work.request().scope().sourceVersionIds()) {
            var version = sources.versionById(work.workspaceId(), work.callerId(), id);
            var set =
                    retrieval.version(work.workspaceId(), version.sourceId(), id, work.callerId());
            if (!work.workspaceId().equals(set.workspaceId()) || !id.equals(set.sourceVersionId()))
                throw new ResourceNotFoundException("Source version was not found");
            chunks.addAll(set.chunks().stream().limit(2).toList());
        }
        observation.record(work,dev.researchhub.audit.application.ProductAudit.CanvasStage.RETRIEVAL,dev.researchhub.ai.observability.CanvasWorkflowObservation.elapsed(retrievalStart),true);
        var selected = chunks.stream().limit(8).toList();
        var citations =
                selected.stream()
                        .map(
                                c ->
                                        Citation.from(
                                                c,
                                                sources.findVersion(
                                                                work.workspaceId(),
                                                                work.callerId(),
                                                                c.sourceId(),
                                                                c.sourceVersionId())
                                                        .originalFilename()))
                        .toList();
        boolean evidence = !work.request().scope().sourceVersionIds().isEmpty();
        String selectedText =
                memory.proposalText() != null ? memory.proposalText() : memory.selectedText();
        var fields = new LinkedHashMap<String, Object>();
        fields.put("kind", evidence ? "DRAFT" : "REWRITE");
        fields.put("selectedText", CanvasFollowupContext.head(selectedText, 1800));
        fields.put(
                "surroundingContext",
                CanvasFollowupContext.head(memory.before() + "\n" + memory.after(), 401));
        fields.put("instruction", CanvasFollowupContext.head(work.request().instruction(), 1000));
        fields.put("action", "EXPAND");
        fields.put("lengthTarget", 400);
        fields.put("stylePreset", "ACADEMIC");
        fields.put("citationRequired", evidence);
        var localized=LocalizedGenerationPolicy.template("canvas-edit:2",instruction,new Parameters(0.0,4096),work.request().answerLanguage());
        var request =
                new Request(
                        "1.0",
                        work.turnId(),
                        localized.templateId(),
                        localized.templateHash(),
                        localized.systemInstruction(),
                        json.writeValueAsString(fields),
                        new Parameters(0.0, 4096),
                        selected.stream()
                                .map(c -> new Evidence(c.chunkId(), c.contentHash(), c.content()))
                                .toList());
        var contextual = grounded.build(request, citations, List.of(), budgets.budget(), memory);
        if (!turns.beginModel(work)) throw new ConflictException("The turn is no longer active");
        var result =
                observation.measure(work,dev.researchhub.audit.application.ProductAudit.CanvasStage.MODEL,()->gateway.author(
                        work.workspaceId(),
                        work.callerId(),
                        contextual,
                        evidence ? AuthoringContracts.Kind.DRAFT : AuthoringContracts.Kind.REWRITE,
                        evidence));
        if (!"READY".equals(result.answer().status())) return null;
        var paragraphs =
                Arrays.stream(result.answer().text().split("\\n\\s*\\n"))
                        .map(String::strip)
                        .filter(s -> !s.isBlank())
                        .toList();
        if (paragraphs.isEmpty() || paragraphs.size() > 16)
            throw new ModelFailure(ApiErrorCode.AI_OUTPUT_INVALID);
        var cited =
                citations.stream()
                        .filter(c -> result.answer().citationIds().contains(c.chunkId()))
                        .toList();
        var warnings =
                new ArrayList<>(
                        new CanvasEdit(json)
                                .warnings(document.content(), target, mode == Mode.REPLACE_RANGE));
        if (!evidence)
            warnings.add(
                    "No source evidence was selected. New factual claims need evidence and human"
                            + " review.");
        if ("deterministic".equals(result.model().provider()))
            warnings.add("Offline fixture: review the proposed text before accepting.");
        UUID id = UUID.randomUUID();
        String version =
                RetrievalIdentity.hash(
                        json.writeValueAsString(List.of(id, contextId, mode, paragraphs, cited)));
        return new Proposal(
                "2.0",
                id,
                work.workspaceId(),
                work.documentId(),
                contextId,
                work.turnId(),
                previous != null && "PENDING".equals(previous.state()) ? previous.id() : null,
                mode,
                "PENDING",
                version,
                documentText(memory),
                paragraphs,
                cited,
                List.copyOf(warnings),
                result,
                contextual.context().summary(),
                clock.instant(),
                null);
    }

    private UUID captureAccepted(Work work, Proposal previous) {
        var blocks =
                provenance.appliedBlocks(
                        work.workspaceId(),
                        work.callerId(),
                        work.documentId(),
                        previous.operationId());
        var doc = documents.findOne(work.workspaceId(), work.callerId(), work.documentId());
        var points = new ArrayList<CanvasTargets.Endpoint>();
        var texts = new ArrayList<String>();
        applied(json.readTree(doc.content()), List.of(), blocks.keySet(), points, texts);
        if (points.isEmpty()) throw CanvasDocumentTarget.stale("TARGET_STALE");
        var first = points.getFirst();
        var last = points.getLast();
        var target =
                new CanvasTargets.Target(
                        CanvasTargets.Kind.TEXT,
                        first,
                        new CanvasTargets.Endpoint(
                                last.blockId(), last.path(), texts.getLast().length()),
                        CanvasDocumentTarget.hash(String.join("\n", texts)));
        return contexts.capture(
                        work.workspaceId(),
                        work.documentId(),
                        work.callerId(),
                        new CanvasContracts.Capture(
                                "1.0",
                                work.turnId(),
                                doc.summary().revision(),
                                null,
                                null,
                                null,
                                null,
                                target))
                .contextId();
    }

    private static void applied(
            tools.jackson.databind.JsonNode node,
            List<Integer> path,
            Set<UUID> ids,
            List<CanvasTargets.Endpoint> points,
            List<String> texts) {
        String id = node.path("attrs").path("blockId").asString(null);
        if (id != null && ids.contains(UUID.fromString(id))) {
            points.add(new CanvasTargets.Endpoint(id, path, 0));
            var text = new StringBuilder();
            for (var c : node.path("content"))
                text.append(
                        "text".equals(c.path("type").asString())
                                ? c.path("text").asString()
                                : "\uFFFC");
            texts.add(text.toString());
            return;
        }
        int i = 0;
        for (var c : node.path("content")) {
            var next = new ArrayList<>(path);
            next.add(i++);
            applied(c, List.copyOf(next), ids, points, texts);
        }
    }

    private static String documentText(Memory m) {
        return m.selectedText();
    }

    public Proposal find(UUID workspace, UUID document, UUID caller, UUID id) {
        documents.findOne(workspace, caller, document);
        var p = store.find(workspace, document, id, false);
        authorize(p, caller);
        return p;
    }

    public void authorize(Proposal p, UUID caller) {
        if(p.calculation()!=null)calculationReferences.validate(p.workspaceId(),caller,json.writeValueAsString(Map.of("type","doc","content",p.calculation().blocks())));
        scope.requireSourceVersions(
                p.workspaceId(),
                caller,
                p.citations().stream().map(Citation::sourceVersionId).distinct().toList());
        for (var c : p.citations())
            retrieval.chunk(
                    p.workspaceId(),
                    c.sourceId(),
                    c.sourceVersionId(),
                    caller,
                    c.chunkId(),
                    c.processingVersion());
    }

    @Transactional
    public Proposal reject(UUID workspace, UUID document, UUID caller, UUID id) {
        documents.lockForReview(workspace, caller, document);
        var p = store.find(workspace, document, id, true);
        if ("ACCEPTED".equals(p.state()))
            throw new ConflictException("This proposal was already accepted");
        store.reject(workspace, id);
        return store.find(workspace, document, id, false);
    }
}
