package dev.researchhub.ai.application;

import dev.researchhub.ai.application.ConversationContracts.*;
import dev.researchhub.shared.error.*;
import dev.researchhub.source.application.SourceReadScope;
import dev.researchhub.workspace.application.WorkspaceAuthorizationService;
import org.junit.jupiter.api.*;
import java.time.*;
import java.util.*;
import java.util.concurrent.CancellationException;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;

class ConversationServiceTest {
    private final UUID workspace=UUID.randomUUID(),caller=UUID.randomUUID(),conversation=UUID.randomUUID();
    private final ConversationStore store=mock(ConversationStore.class);
    private final WorkspaceAuthorizationService authorization=mock(WorkspaceAuthorizationService.class);
    private final SourceReadScope sources=mock(SourceReadScope.class);
    private final WorkspaceQuestionService questions=mock(WorkspaceQuestionService.class);
    private final dev.researchhub.analysis.application.AnalysisEvidenceService computed=mock(dev.researchhub.analysis.application.AnalysisEvidenceService.class);
    private final ConversationService service=new ConversationService(store,authorization,sources,questions,computed);
    private final Send send=new Send(UUID.randomUUID(),"Visible question",List.of(UUID.randomUUID()));
    private final Message user=new Message(UUID.randomUUID(),send.clientRequestId(),1,"USER","PENDING",caller,send.question(),send.selectedSourceIds(),null,null,Instant.now(),null);
    private final QuestionContracts.Response response=new QuestionContracts.Response("INSUFFICIENT_EVIDENCE","NO_RETRIEVED_EVIDENCE",WorkspaceQuestionService.NO_EVIDENCE,List.of(),null);
    private final Message assistant=new Message(UUID.randomUUID(),send.clientRequestId(),2,"ASSISTANT","COMPLETED",null,response.answer(),null,response,null,Instant.now(),Instant.now());
    private final Claim claim=new Claim(UUID.randomUUID(),user,null);
    @BeforeEach void prepare() {
        when(store.claim(workspace,conversation,caller,send)).thenReturn(claim);
        when(questions.answer(eq(workspace),eq(caller),eq(send.asQuestion()),any(QuestionExecution.class))).thenReturn(response);
        when(store.complete(workspace,conversation,claim,response)).thenReturn(new Completion(user,assistant));
    }
    @Test void authorizesEveryOperationAndEverySelectedSourceBeforeClaiming() {
        doThrow(new ResourceNotFoundException("missing")).when(authorization).requireContentReader(workspace,caller);
        assertThrows(ResourceNotFoundException.class,()->service.create(workspace,caller,new Create("Title")));
        assertThrows(ResourceNotFoundException.class,()->service.list(workspace,caller,0,25));
        assertThrows(ResourceNotFoundException.class,()->service.history(workspace,caller,conversation,null,25));
        assertThrows(ResourceNotFoundException.class,()->service.send(workspace,caller,conversation,send,QuestionExecution.NONE));
        verifyNoInteractions(store,sources,questions);
        reset(authorization);
        doThrow(new ResourceNotFoundException("source missing")).when(sources).requireSources(workspace,caller,send.selectedSourceIds());
        assertThrows(ResourceNotFoundException.class,()->service.send(workspace,caller,conversation,send,QuestionExecution.NONE));
        verify(store,never()).claim(any(),any(),any(),any());verifyNoInteractions(questions);
    }
    @Test void visibleInputsAndOnlyCompleteAnswersArePersistedAfterFinalAuthorization() {
        var control=mock(QuestionExecution.class);
        assertEquals(new Completion(user,assistant),service.send(workspace,caller,conversation,send,control));
        var order=inOrder(authorization,store,sources,control,questions);
        order.verify(authorization).requireContentReader(workspace,caller);
        order.verify(store).find(workspace,conversation);
        order.verify(sources).requireSources(workspace,caller,send.selectedSourceIds());
        order.verify(control).checkpoint();order.verify(store).claim(workspace,conversation,caller,send);
        order.verify(control).started(user);order.verify(control).checkpoint();
        order.verify(questions).answer(workspace,caller,send.asQuestion(),control);
        order.verify(control).checkpoint();order.verify(authorization).requireContentReader(workspace,caller);
        order.verify(store).complete(workspace,conversation,claim,response);
        verify(store,never()).fail(any(),any(),any(),any(),anyBoolean());
    }
    @Test void completedRequestReplayDoesNotCallTheModelOrAppendAnotherAssistant() {
        var cached=new Claim(null,user,assistant);
        when(store.claim(workspace,conversation,caller,send)).thenReturn(cached);
        assertEquals(new Completion(user,assistant),service.send(workspace,caller,conversation,send,QuestionExecution.NONE));
        verifyNoInteractions(questions);verify(store,never()).complete(any(),any(),any(),any());
    }
    @Test void disconnectAbandonsTheAttemptAndNeverWritesAPartialAssistant() {
        var control=mock(QuestionExecution.class);
        doNothing().doThrow(new CancellationException()).when(control).checkpoint();
        assertThrows(CancellationException.class,()->service.send(workspace,caller,conversation,send,control));
        verify(store).fail(workspace,conversation,claim,ApiErrorCode.CONFLICT,true);verifyNoInteractions(questions);
        verify(store,never()).complete(any(),any(),any(),any());
    }
    @Test void revokedMembershipAfterInferencePreventsFinalHistoryPublication() {
        doNothing().doThrow(new ResourceNotFoundException("revoked")).when(authorization).requireContentReader(workspace,caller);
        assertThrows(ResourceNotFoundException.class,()->service.send(workspace,caller,conversation,send,QuestionExecution.NONE));
        verify(store).fail(workspace,conversation,claim,ApiErrorCode.RESOURCE_NOT_FOUND,false);
        verify(store,never()).complete(any(),any(),any(),any());
    }
    @Test void errorsRetainOnlySafeCodesAndAnInterruptedProviderFailureBecomesAbandoned() {
        when(questions.answer(any(),any(),any(),any())).thenThrow(new ModelFailure(ApiErrorCode.AI_UNAVAILABLE));
        assertEquals(ApiErrorCode.AI_UNAVAILABLE,assertThrows(ApiException.class,()->service.send(workspace,caller,conversation,send,QuestionExecution.NONE)).code());
        verify(store).fail(workspace,conversation,claim,ApiErrorCode.AI_UNAVAILABLE,false);
        var control=mock(QuestionExecution.class);
        doNothing().doNothing().doThrow(new CancellationException()).when(control).checkpoint();
        assertThrows(CancellationException.class,()->service.send(workspace,caller,conversation,send,control));
        verify(store).fail(workspace,conversation,claim,ApiErrorCode.CONFLICT,true);
        doThrow(new IllegalStateException("hidden provider reasoning and secret key")).when(questions).answer(any(),any(),any(),any());
        var error=assertThrows(ApiException.class,()->service.send(workspace,caller,conversation,send,QuestionExecution.NONE));
        assertEquals(ApiErrorCode.INTERNAL_ERROR,error.code());assertNull(error.getCause());assertFalse(error.getMessage().contains("secret"));
        verify(store).fail(workspace,conversation,claim,ApiErrorCode.INTERNAL_ERROR,false);
    }
    @Test void paginationAndTemplatesRemainBoundedAndReadsRecheckAccess() {
        var row=new Conversation(conversation,workspace,caller,"Title",Instant.now(),Instant.now());
        when(store.create(workspace,caller,"Title")).thenReturn(row);
        assertEquals(row,service.create(workspace,caller,new Create(" Title ")));
        var page=new ConversationPage(List.of(row),null);when(store.list(workspace,0,25)).thenReturn(page);
        assertEquals(page,service.list(workspace,caller,0,25));
        var history=new History(row,List.of(user,assistant),null);when(store.history(workspace,conversation,null,25)).thenReturn(history);
        assertEquals(history,service.history(workspace,caller,conversation,null,25));
        for (int offset:new int[]{-1,100001}) assertThrows(ApiException.class,()->service.list(workspace,caller,offset,25));
        for (int limit:new int[]{0,51}) assertThrows(ApiException.class,()->service.list(workspace,caller,0,limit));
        for (int limit:new int[]{0,26}) assertThrows(ApiException.class,()->service.history(workspace,caller,conversation,null,limit));
        assertThrows(ApiException.class,()->service.history(workspace,caller,conversation,0L,25));
        assertEquals("Research conversation",new Create(null).title());
        assertThrows(IllegalArgumentException.class,()->new Create(" "));
        assertThrows(IllegalArgumentException.class,()->new Create("x".repeat(161)));
        assertThrows(IllegalArgumentException.class,()->new Send(null,"Q",null));
        var props=new ConversationStreamProperties(8,Duration.ofSeconds(90),Duration.ofSeconds(10));assertEquals(8,props.maxConcurrent());
        assertThrows(IllegalArgumentException.class,()->new ConversationStreamProperties(0,props.timeout(),props.heartbeat()));
        assertThrows(IllegalArgumentException.class,()->new ConversationStreamProperties(8,Duration.ofMinutes(5),props.heartbeat()));
        assertThrows(IllegalArgumentException.class,()->new ConversationStreamProperties(8,props.timeout(),Duration.ofSeconds(60)));
    }
}
