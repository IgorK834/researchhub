package dev.researchhub.analysis.application;

import dev.researchhub.analysis.application.AnalysisContracts.*;
import dev.researchhub.analysis.domain.AnalysisStatus;
import dev.researchhub.ai.application.ModelFailure;
import dev.researchhub.shared.error.*;
import dev.researchhub.source.application.SourceReadScope;
import dev.researchhub.workspace.application.WorkspaceAuthorizationService;
import org.junit.jupiter.api.*;
import tools.jackson.databind.json.JsonMapper;
import java.nio.file.*;
import java.time.*;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import org.mockito.ArgumentCaptor;

class AnalysisPlanningTest {
    private final JsonMapper json=JsonMapper.builder().findAndAddModules().build();
    private final WorkspaceAuthorizationService auth=mock(WorkspaceAuthorizationService.class);
    private final SourceReadScope scope=mock(SourceReadScope.class);
    private final DatasetPreviewService previews=mock(DatasetPreviewService.class);
    private final AnalysisStore store=mock(AnalysisStore.class);
    private final AnalysisPlanner planner=mock(AnalysisPlanner.class);
    private final UUID workspace=UUID.randomUUID(),caller=UUID.randomUUID(),id=UUID.randomUUID();
    private final Clock clock=Clock.fixed(Instant.parse("2026-10-03T10:00:00Z"),ZoneOffset.UTC);
    private AnalysisService service;
    private PlanningRequest request;
    private Plan plan;
    private Candidate candidate;
    private Analysis draft;
    @BeforeEach void prepare() throws Exception {
        Path root=Path.of("../contracts/analysis/computation-plan/v1");
        request=json.readValue(Files.readString(root.resolve("request.json")),PlanningRequest.class);
        plan=json.readValue(Files.readString(root.resolve("plan.json")),Plan.class);
        candidate=json.readValue(Files.readString(root.resolve("candidate.json")),Candidate.class);
        draft=new Analysis(id,workspace,caller,"Compute a table",AnalysisStatus.DRAFT,clock.instant(),clock.instant(),
            request.inputs().stream().map(InspectedInput::selection).toList(),null,null,null);
        when(store.find(workspace,id)).thenReturn(draft);
        when(store.beginPlanning(eq(workspace),eq(id),any())).thenReturn(true);
        for (var input:request.inputs()) when(previews.preview(workspace,input.selection().sourceId(),input.selection().sourceVersionId(),caller)).thenReturn(input.preview());
        when(planner.plan(any())).thenAnswer(invocation -> matching(invocation.getArgument(0),candidate.output()));
        service=new AnalysisService(auth,scope,previews,store,planner,json,clock);
    }
    private Candidate matching(PlanningRequest input,String output) {
        return new Candidate("1.0",input.request().requestId(),candidate.model(),candidate.usage(),candidate.providerRequestId(),output);
    }
    @Test void createsAnEngineIndependentWorkspaceRequestAndReadsBoundedHistory() {
        when(store.create(any())).thenAnswer(i -> i.getArgument(0));
        var created=service.create(workspace,caller,new Create(draft.userPrompt(),draft.inputs()));
        assertEquals(AnalysisStatus.DRAFT,created.status()); assertEquals(workspace,created.workspaceId()); assertEquals(caller,created.createdBy());
        assertNull(created.plan()); verify(auth).requireContentEditor(workspace,caller);
        when(store.list(workspace,0)).thenReturn(List.of(created)); assertEquals(List.of(created),service.list(workspace,caller,0));
        assertThrows(ApiException.class,() -> service.list(workspace,caller,-1));
        assertThrows(ApiException.class,() -> service.list(workspace,caller,100001));
        when(store.attempts(workspace,id)).thenReturn(List.of()); assertTrue(service.attempts(workspace,caller,id).isEmpty());
    }
    @Test void persistsValidatedIntentAndRechecksAuthorizationBeforeApproval() {
        service.plan(workspace,caller,id);
        var captor=ArgumentCaptor.forClass(PlanAudit.class); verify(store).recordAttempt(eq(workspace),eq(id),captor.capture());
        assertEquals(plan,captor.getValue().plan()); assertNull(captor.getValue().failureCode());
        assertEquals(request.inputs(),captor.getValue().request().inputs()); assertEquals(1,captor.getValue().attempt());
        verify(store).complete(eq(workspace),eq(id),eq(captor.getValue().id()),eq(plan),any());
        verify(auth,atLeast(2)).requireContentEditor(workspace,caller);
        verify(planner,times(1)).plan(any());
    }
    @Test void retriesInvalidJsonWithABoundedRepairHintAndRetainsRejectedCandidate() {
        reset(planner);
        when(planner.plan(any())).thenAnswer(i -> matching(i.getArgument(0),"{\"code\":\"arbitrary\"}"))
            .thenAnswer(i -> matching(i.getArgument(0),candidate.output()));
        service.plan(workspace,caller,id);
        var audits=ArgumentCaptor.forClass(PlanAudit.class); verify(store,times(2)).recordAttempt(eq(workspace),eq(id),audits.capture());
        assertEquals("AI_OUTPUT_INVALID",audits.getAllValues().get(0).failureCode()); assertNull(audits.getAllValues().get(0).plan());
        assertEquals("{\"code\":\"arbitrary\"}",audits.getAllValues().get(0).candidate().output());
        assertEquals(1,audits.getAllValues().get(1).request().repairHints().size());
    }
    @Test void invalidOrUnavailableOutputStopsAtThreeAndLeavesAFailedAuditedRequest() {
        for (var error:List.of(ApiErrorCode.AI_OUTPUT_INVALID,ApiErrorCode.AI_UNAVAILABLE)) {
            reset(planner); when(planner.plan(any())).thenThrow(new ModelFailure(error));
            assertEquals(error,assertThrows(ModelFailure.class,() -> service.plan(workspace,caller,id)).code());
            verify(planner,times(3)).plan(any()); verify(store).fail(eq(workspace),eq(id),eq(error.name()),any());
        }
        verify(store,never()).complete(any(),any(),any(),any(),any());
    }
    @Test void refusesUnprovidedFilesSheetsColumnsAndInvalidCandidateIdentity() {
        String[] invalid={candidate.output().replace(request.inputs().getFirst().selection().sourceVersionId().toString(),UUID.randomUUID().toString()),
            candidate.output().replace("CSV","Private"),candidate.output().replace("[1, 2]","[1, 99]"),
            candidate.output()+" {}","null"};
        for (String output:invalid) {
            reset(planner); when(planner.plan(any())).thenAnswer(i -> matching(i.getArgument(0),output));
            assertEquals(ApiErrorCode.AI_OUTPUT_INVALID,assertThrows(ModelFailure.class,() -> service.plan(workspace,caller,id)).code());
            verify(planner,times(3)).plan(any());
        }
        reset(planner); when(planner.plan(any())).thenReturn(candidate);
        assertEquals(ApiErrorCode.AI_OUTPUT_INVALID,assertThrows(ModelFailure.class,() -> service.plan(workspace,caller,id)).code());
    }
    @Test void refusesAViewerForeignInputAndUninspectedSelectionBeforeCallingTheModel() {
        doThrow(new ForbiddenException("Viewer")).when(auth).requireContentEditor(workspace,caller);
        assertThrows(ForbiddenException.class,() -> service.create(workspace,caller,new Create(draft.userPrompt(),draft.inputs())));
        verifyNoInteractions(planner); reset(auth);
        doThrow(new ResourceNotFoundException("Missing")).when(scope).requireSourceVersions(any(),any(),any());
        assertThrows(ResourceNotFoundException.class,() -> service.create(workspace,caller,new Create(draft.userPrompt(),draft.inputs())));
        reset(scope);
        var input=draft.inputs().getFirst();
        assertThrows(ApiException.class,() -> service.create(workspace,caller,new Create("Calculate",List.of(new Input(input.sourceId(),input.sourceVersionId(),"Not inspected",null)))));
        verify(store,never()).create(any());
    }
    @Test void readyPlanningIsIdempotentAndAConcurrentClaimCannotGenerateTwice() {
        var ready=new Analysis(id,workspace,caller,draft.userPrompt(),AnalysisStatus.READY_TO_EXECUTE,clock.instant(),clock.instant(),draft.inputs(),UUID.randomUUID(),plan,null);
        when(store.find(workspace,id)).thenReturn(ready); assertEquals(ready,service.plan(workspace,caller,id)); verifyNoInteractions(planner);
        when(store.find(workspace,id)).thenReturn(draft); when(store.beginPlanning(any(),any(),any())).thenReturn(false);
        assertThrows(ConflictException.class,() -> service.plan(workspace,caller,id)); verifyNoInteractions(planner);
    }
    @Test void providerExceptionsAreSanitizedAndRevocationPreventsApproval() {
        reset(planner);
        when(planner.plan(any())).thenThrow(new IllegalStateException("secret provider body"));
        assertEquals(ApiErrorCode.AI_PROVIDER_ERROR,assertThrows(ModelFailure.class,() -> service.plan(workspace,caller,id)).code());
        verify(planner,times(1)).plan(any());
        reset(planner); when(planner.plan(any())).thenAnswer(i -> { doThrow(new ForbiddenException("Revoked")).when(auth).requireContentEditor(workspace,caller);return matching(i.getArgument(0),candidate.output()); });
        assertThrows(ForbiddenException.class,() -> service.plan(workspace,caller,id)); verify(store,never()).complete(any(),any(),any(),any(),any());
        verify(store).fail(eq(workspace),eq(id),eq("FORBIDDEN"),any());
    }
    @Test void allLifecycleTransitionsAreExplicitAndRetriesRequireANewQueuedAttempt() {
        for (var from:AnalysisStatus.values()) for (var to:AnalysisStatus.values()) {
            boolean expected=switch(from) { case DRAFT -> to==AnalysisStatus.PLANNING; case PLANNING -> to==AnalysisStatus.READY_TO_EXECUTE || to==AnalysisStatus.FAILED;
                case READY_TO_EXECUTE,SUCCEEDED,FAILED -> to==AnalysisStatus.QUEUED; case QUEUED -> to==AnalysisStatus.RUNNING || to==AnalysisStatus.FAILED;
                case RUNNING -> to==AnalysisStatus.SUCCEEDED || to==AnalysisStatus.FAILED; };
            assertEquals(expected,from.canTransitionTo(to));
        }
    }
    @Test void changedInspectionCannotApproveAnOlderSnapshot() {
        reset(planner);
        when(planner.plan(any())).thenAnswer(invocation -> {
            var input=request.inputs().getFirst();var old=input.preview();
            var changed=new DatasetPreview(old.schemaVersion(),old.sourceId(),old.sourceVersionId(),old.versionNumber(),
                old.originalFilename(),old.sizeBytes(),old.contentSha256(),old.format(),old.formulasEvaluated(),true,
                old.limits(),old.warnings(),old.sheets());
            when(previews.preview(workspace,input.selection().sourceId(),input.selection().sourceVersionId(),caller)).thenReturn(changed);
            return matching(invocation.getArgument(0),candidate.output());
        });
        assertThrows(ConflictException.class,() -> service.plan(workspace,caller,id));
        verify(store).fail(eq(workspace),eq(id),eq("CONFLICT"),any());
        verify(store,never()).complete(any(),any(),any(),any(),any());
    }
}
