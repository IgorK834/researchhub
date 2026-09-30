package dev.researchhub.ai.application;

import dev.researchhub.ai.application.GenerationContracts.*;
import dev.researchhub.ai.application.QuestionContracts.*;
import dev.researchhub.shared.error.*;
import dev.researchhub.workspace.application.WorkspaceAuthorizationService;
import org.junit.jupiter.api.*;
import org.mockito.ArgumentCaptor;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;

class WorkspaceQuestionServiceTest {
    private final UUID workspace = UUID.randomUUID(), caller = UUID.randomUUID(), source = UUID.randomUUID();
    private final WorkspaceAuthorizationService authorization = mock(WorkspaceAuthorizationService.class);
    private final RetrievalSearchService retrieval = mock(RetrievalSearchService.class);
    private final ModelGateway gateway = mock(ModelGateway.class);
    private QuestionFeature feature;
    private WorkspaceQuestionService service;
    private List<RetrievalHit> hits;
    private GeneratedResponse generated;
    @BeforeEach void prepare() throws Exception {
        feature = new QuestionFeature(2, "0", 512);
        service = new WorkspaceQuestionService(authorization, retrieval, gateway, feature);
        hits = List.of(hit("a", workspace, source), hit("b", workspace, source));
        when(retrieval.search(anyString(), eq(workspace), nullable(List.class), eq(2), eq(caller))).thenReturn(hits);
        generated = response(hits, new Answer("SUPPORTED", List.of(
            new Claim("Supported first claim.", List.of(hits.getFirst().chunk().chunkId())),
            new Claim("Supported second claim.", List.of(hits.getFirst().chunk().chunkId())))));
        when(gateway.generate(eq(workspace), eq(caller), any(Command.class), same(feature))).thenReturn(generated);
    }
    private RetrievalHit hit(String key, UUID workspaceId, UUID sourceId) {
        var chunk = new RetrievalChunk(key.repeat(64), sourceId, workspaceId, null, 0, "Lecture evidence " + key, 38, 38, "Theory",
            RetrievalIdentity.hash("Lecture evidence " + key), "retrieval-1:test", List.of(new SourceSpan("page-38", 0, 18)));
        return new RetrievalHit(chunk, 1, 1, 1, new EmbeddingModel("fake", "model", "1", 4));
    }
    private GeneratedResponse response(List<RetrievalHit> retrieved, Answer answer) {
        return new GeneratedResponse(new Result("1.0", UUID.randomUUID(), feature.templateId(), feature.templateHash(),
            new ModelMetadata("deterministic", "fixture", "1", true, false), new Usage(20, 10, 30, true), "request", answer),
            retrieved.stream().map(h -> Citation.from(h.chunk(), "Lecture")).toList());
    }
    @Test void usesConfiguredRankedRetrievalAndMapsOnlyCitedRealChunks() {
        var result = service.answer(workspace, caller, new Question("What is in Lecture?", List.of(source)));
        assertEquals("SUPPORTED", result.status()); assertNull(result.reason());
        assertEquals("Supported first claim.\n\nSupported second claim.", result.answer());
        assertEquals(List.of(generated.evidence().getFirst()), result.citations()); assertEquals(generated, result.generation());
        var command = ArgumentCaptor.forClass(Command.class);
        var order = inOrder(authorization, retrieval, gateway);
        order.verify(authorization).requireContentReader(workspace, caller);
        order.verify(retrieval).search("What is in Lecture?", workspace, List.of(source), 2, caller);
        order.verify(gateway).generate(eq(workspace), eq(caller), command.capture(), same(feature));
        assertEquals(hits.stream().map(h -> new EvidenceReference(h.chunk().sourceId(), h.chunk().chunkId(), h.chunk().processingVersion())).toList(), command.getValue().evidence());
        assertEquals("workspace-question:1", feature.templateId()); assertEquals(new Parameters(0.0,512), feature.parameters());
        assertTrue(feature.systemInstruction().contains("INSUFFICIENT_EVIDENCE"));
    }
    @Test void authorizationAndSelectedSourceErrorsStopBeforeGeneration() {
        doThrow(new ResourceNotFoundException("missing")).when(authorization).requireContentReader(workspace,caller);
        assertThrows(ResourceNotFoundException.class, () -> service.answer(workspace,caller,new Question("Question",null)));
        verifyNoInteractions(retrieval,gateway);
        reset(authorization);
        when(retrieval.search(anyString(),any(),any(),anyInt(),any())).thenThrow(new ResourceNotFoundException("missing source"));
        assertThrows(ResourceNotFoundException.class, () -> service.answer(workspace,caller,new Question("Question",List.of(source))));
        verifyNoInteractions(gateway);
    }
    @Test void noRetrievedEvidenceReturnsAnExplicitResultWithoutModelOrAuditCalls() {
        when(retrieval.search(anyString(),any(),nullable(List.class),anyInt(),any())).thenReturn(List.of());
        for (List<UUID> selected : Arrays.asList(null, List.<UUID>of(), List.of(source))) {
            var result = service.answer(workspace,caller,new Question("Question",selected));
            assertEquals("INSUFFICIENT_EVIDENCE",result.status()); assertEquals("NO_RETRIEVED_EVIDENCE",result.reason());
            assertEquals(WorkspaceQuestionService.NO_EVIDENCE,result.answer()); assertTrue(result.citations().isEmpty()); assertNull(result.generation());
        }
        verifyNoInteractions(gateway);
    }
    @Test void modelInsufficiencyHasNoCitationsAndRetainsItsAuditMetadata() {
        generated = response(hits,new Answer("INSUFFICIENT_EVIDENCE",List.of()));
        when(gateway.generate(any(),any(),any(),same(feature))).thenReturn(generated);
        var result = service.answer(workspace,caller,new Question("Unanswerable",null));
        assertEquals("INSUFFICIENT_RETRIEVED_EVIDENCE",result.reason()); assertEquals(WorkspaceQuestionService.INSUFFICIENT,result.answer());
        assertTrue(result.citations().isEmpty()); assertEquals(generated,result.generation());
    }
    @Test void rejectsAdapterScopeViolationsDuplicateHitsAndExcessiveResultsBeforeInference() {
        for (List<RetrievalHit> invalid : List.of(List.of(hit("a",UUID.randomUUID(),source)),
            List.of(hit("a",workspace,UUID.randomUUID())), List.of(hits.getFirst(),hits.getFirst()),
            List.of(hits.getFirst(),hits.get(1),hit("c",workspace,source)))) {
            when(retrieval.search(anyString(),any(),any(),anyInt(),any())).thenReturn(invalid);
            assertEquals(ApiErrorCode.AI_OUTPUT_INVALID,assertThrows(ModelFailure.class,
                () -> service.answer(workspace,caller,new Question("Question",List.of(source)))).code());
        }
        verifyNoInteractions(gateway);
    }
    @Test void rejectsFabricatedCitationLocationsAndEvidenceOutsideRetrievedContext() {
        for (GeneratedResponse invalid : List.of(response(List.of(hits.getFirst()),generated.result().answer()),
            response(List.of(hit("c",workspace,source),hits.get(1)),generated.result().answer()),
            response(List.of(hit("a",workspace,UUID.randomUUID()),hits.get(1)),generated.result().answer()),
            response(hits,new Answer("SUPPORTED",List.of(new Claim("Invented",List.of("f".repeat(64)))))))) {
            when(gateway.generate(any(),any(),any(),same(feature))).thenReturn(invalid);
            assertEquals(ApiErrorCode.AI_OUTPUT_INVALID,assertThrows(ModelFailure.class,
                () -> service.answer(workspace,caller,new Question("Question",null))).code());
        }
    }
    @Test void validatesPublicInputAndFeatureLimits() throws Exception {
        for (String invalid : Arrays.asList(null," ","q".repeat(2001))) assertThrows(IllegalArgumentException.class,() -> new Question(invalid,null));
        assertThrows(IllegalArgumentException.class,() -> new Question("Question",Collections.nCopies(101,source)));
        assertThrows(IllegalArgumentException.class,() -> new Question("Question",List.of(source,source)));
        assertThrows(NullPointerException.class,() -> new Question("Question",Collections.singletonList(null)));
        assertThrows(IllegalArgumentException.class,() -> new QuestionFeature(0,"0",512));
        assertThrows(IllegalArgumentException.class,() -> new QuestionFeature(13,"0",512));
        assertNull(new QuestionFeature(12,"none",512).parameters().temperature());
    }
    @Test void sharedQuestionFixturesMatchJavaContextPolicyAndPublicResponse() throws Exception {
        var json = new tools.jackson.databind.ObjectMapper();
        var folder = java.nio.file.Path.of("../contracts/ai/questions/v1");
        var contextual = json.readValue(java.nio.file.Files.readString(folder.resolve("model-request.json")),ContextContracts.ContextualRequest.class);
        var expected = json.readValue(java.nio.file.Files.readString(folder.resolve("response.json")),Response.class);
        var question = json.readValue(java.nio.file.Files.readString(folder.resolve("request.json")),Question.class);
        feature = new QuestionFeature(6,"0",1024);
        assertEquals(feature.systemInstruction(),contextual.request().systemInstruction());
        assertEquals(feature.templateHash(),contextual.request().templateHash());
        assertEquals(feature.parameters(),contextual.request().parameters());
        assertEquals(contextual,new GroundedContextBuilder().build(contextual.request(),expected.generation().evidence(),contextual.context().summary().budget()));
        var citation = expected.citations().getFirst();
        var chunk = new RetrievalChunk(citation.chunkId(),citation.sourceId(),citation.workspaceId(),citation.sourceVersionId(),0,
            contextual.request().evidence().getFirst().content(),citation.pageStart(),citation.pageEnd(),citation.sectionTitle(),citation.contentHash(),citation.processingVersion(),citation.spans());
        when(retrieval.search(eq(question.question()),eq(citation.workspaceId()),eq(question.selectedSourceIds()),eq(6),eq(caller)))
            .thenReturn(List.of(new RetrievalHit(chunk,1,1,1,new EmbeddingModel("fake","model","1",4))));
        when(gateway.generate(eq(citation.workspaceId()),eq(caller),any(),same(feature))).thenReturn(expected.generation());
        var actual = new WorkspaceQuestionService(authorization,retrieval,gateway,feature).answer(citation.workspaceId(),caller,question);
        assertEquals(expected,actual);
        assertEquals("NO_RETRIEVED_EVIDENCE",json.readValue(java.nio.file.Files.readString(folder.resolve("no-evidence.json")),Response.class).reason());
    }
}
