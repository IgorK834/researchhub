package dev.researchhub.ai.application;

import dev.researchhub.ai.application.CanvasConversationContracts.*;
import dev.researchhub.ai.application.ConversationContracts.*;
import dev.researchhub.ai.application.CanvasContracts.*;
import dev.researchhub.document.application.*;
import dev.researchhub.document.application.CanvasTargets.*;
import dev.researchhub.source.application.SourceReadScope;
import dev.researchhub.analysis.application.AnalysisEvidenceService;
import dev.researchhub.shared.error.*;
import org.junit.jupiter.api.*;
import tools.jackson.databind.ObjectMapper;
import java.time.Instant;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;

class CanvasFollowupContextTest {
    UUID workspace=UUID.randomUUID(),caller=UUID.randomUUID(),conversation=UUID.randomUUID(),document=UUID.randomUUID(),context=UUID.randomUUID(),version=UUID.randomUUID();
    ConversationStore conversations=mock(ConversationStore.class);CanvasTurnStore turns=mock(CanvasTurnStore.class);
    CanvasContextService contexts=mock(CanvasContextService.class);AuthoringStore proposals=mock(AuthoringStore.class);
    DocumentProvenance provenance=mock(DocumentProvenance.class);SourceReadScope sources=mock(SourceReadScope.class);
    AnalysisEvidenceService analyses=mock(AnalysisEvidenceService.class);ObjectMapper json=new ObjectMapper();
    CanvasFollowupContext builder=new CanvasFollowupContext(conversations,turns,contexts,proposals,provenance,sources,analyses,json);
    Scope scope=new Scope(List.of(version),List.of());
    List<Message> messages=new ArrayList<>();List<TurnState> states=new ArrayList<>();
    @BeforeEach void setup() {
        var endpoint=new Endpoint(UUID.randomUUID().toString(),List.of(0),0);
        when(contexts.find(workspace,document,caller,context)).thenReturn(new Context("1.0",context,workspace,document,1,null,null,
            new Snapshot(new Target(Kind.TEXT,endpoint,endpoint,CanvasDocumentTarget.hash("text")),"text","before","after",List.of(),List.of()),Instant.now()));
        when(conversations.history(any(),any(),isNull(),eq(25))).thenAnswer(i->new History(new Conversation(conversation,workspace,caller,"Title",Instant.now(),Instant.now()),messages,null));
        when(turns.history(any(),any(),any())).thenAnswer(i->states);
    }
    Work work(String text,UUID reply,UUID proposal,Scope selected) {
        var request=new Turn("1.0",UUID.randomUUID(),context,Intent.ANSWER,text,reply,proposal,selected);
        var user=new Message(UUID.randomUUID(),request.clientRequestId(),101,"USER","PENDING",caller,text,List.of(),null,null,Instant.now(),null);
        return new Work(workspace,caller,conversation,document,UUID.randomUUID(),UUID.randomUUID(),request,new Claim(UUID.randomUUID(),user,null));
    }
    void pair(long sequence,Scope selected,String answer) {
        UUID request=UUID.randomUUID(),user=UUID.randomUUID(),assistant=UUID.randomUUID();
        messages.add(new Message(user,request,sequence,"USER","COMPLETED",caller,"Explain",List.of(),null,null,Instant.now(),Instant.now()));
        messages.add(new Message(assistant,request,sequence+1,"ASSISTANT","COMPLETED",null,answer,null,null,null,Instant.now(),Instant.now()));
        states.add(new TurnState("1.0",UUID.randomUUID(),conversation,"COMPLETED",assistant,null,null,null,context,Intent.ANSWER,selected,"ANSWER",null));
    }
    @Test void reauthorizesOnlyCurrentSubsetAndExcludesAllNarrowedPairs() {
        pair(1,scope,"Old private claim");
        var result=builder.build(work("Explain",null,null,new Scope(List.of(),List.of())));
        assertTrue(result.memory().history().isEmpty());assertEquals(2,result.memory().omittedMessages());verifyNoInteractions(sources,analyses);
        assertFalse(json.writeValueAsString(result.memory()).contains("private"));
        result=builder.build(work("More",messages.getLast().id(),null,scope));
        assertNull(result.clarification());assertEquals(2,result.memory().history().size());assertEquals("MODEL_EXPLANATION",result.memory().history().getLast().classification());
        verify(sources).requireSourceVersions(workspace,caller,List.of(version));verify(analyses).resolve(workspace,caller,List.of());
        doThrow(new ResourceNotFoundException("revoked")).when(sources).requireSourceVersions(any(),any(),any());
        assertThrows(ResourceNotFoundException.class,()->builder.build(work("More",null,null,scope)));
    }
    @Test void capsRecentMessagesAndUtf8BytesAndNeverSplitsSurrogatePairs() {
        for(int i=0;i<5;i++)pair(i*2+1,scope,"A complete answer");
        var built=builder.build(work("More",null,null,scope));assertEquals(6,built.memory().history().size());assertEquals(4,built.memory().omittedMessages());
        assertEquals(messages.get(4).id(),built.memory().history().getFirst().messageId());
        assertEquals("1.0",builder.summary(built.memory()).schemaVersion());
        assertEquals(64,builder.summary(built.memory()).memoryHash().length());
        assertNotNull(builder.build(work("More",messages.getFirst().id(),null,scope)).clarification());
        messages.clear();states.clear();pair(1,scope,"α".repeat(2000));pair(3,scope,"α".repeat(2000));
        var limited=builder.build(work("More",null,null,scope));assertTrue(limited.memory().history().size()<4);
        assertEquals("x",CanvasFollowupContext.head("x😀y",2));assertEquals("😀",CanvasFollowupContext.head("😀y",2));
        var pending=messages.getFirst();messages.set(0,new Message(pending.id(),pending.clientRequestId(),1,"USER","FAILED",caller,"Failed",List.of(),null,null,Instant.now(),Instant.now()));
        assertTrue(builder.build(work("More",null,null,scope)).memory().history().stream().noneMatch(m->m.content().equals("Failed")));
    }
    @Test void ambiguousOrForeignReferencesAskForClarification() {
        assertNotNull(builder.build(work("Rozwiń tę propozycję",null,null,scope)).clarification());
        assertNotNull(builder.build(work("Expand inserted text",null,null,scope)).clarification());
        assertNotNull(builder.build(work("Explain that result",null,null,scope)).clarification());
        assertNotNull(builder.build(work("Explain that chart",null,null,scope)).clarification());
        assertNotNull(builder.build(work("Explain",UUID.randomUUID(),null,scope)).clarification());
        var reference=new AnalysisEvidenceService.Reference(UUID.randomUUID(),UUID.randomUUID(),"output");
        assertNull(builder.build(work("Explain that result",null,null,new Scope(List.of(),List.of(reference)))).clarification());
    }
    AuthoringContracts.Suggestion proposal(UUID id,String state,List<GenerationContracts.Citation> citations) {
        return new AuthoringContracts.Suggestion(id,workspace,document,caller,state,null,"old","Proposal text",citations,List.of(),List.of(),null,null,Instant.now(),null);
    }
    @Test void explicitProposalsResolveCorrectIdAndAcceptedTextUsesCurrentRecordedBlocks() {
        UUID proposal=UUID.randomUUID();when(proposals.find(workspace,document,proposal,false)).thenReturn(proposal(proposal,"PENDING",List.of()));
        var result=builder.build(work("Expand this proposal",null,proposal,scope));assertNull(result.clarification());assertEquals(proposal,result.memory().targetProposalId());assertEquals("Proposal text",result.memory().proposalText());
        UUID block=UUID.randomUUID();when(proposals.find(workspace,document,proposal,false)).thenReturn(proposal(proposal,"ACCEPTED",List.of()));
        when(provenance.appliedBlocks(workspace,caller,document,proposal)).thenReturn(Map.of(block,json.readTree("{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"text\":\"Current edited text\"}]}")));
        result=builder.build(work("Expand inserted text",null,proposal,scope));assertEquals("Current edited text",result.memory().selectedText());assertEquals(List.of(block),result.memory().appliedBlockIds());assertNull(result.memory().proposalText());
        when(proposals.find(workspace,document,proposal,false)).thenReturn(proposal(proposal,"REJECTED",List.of()));
        assertThrows(ConflictException.class,()->builder.build(work("Expand",null,proposal,scope)));
        when(proposals.find(workspace,document,proposal,false)).thenReturn(proposal(proposal,"PENDING",List.of(new GenerationContracts.Citation("a".repeat(64),workspace,UUID.randomUUID(),UUID.randomUUID(),"v1","b".repeat(64),null,null,null,List.of(),"Other source"))));
        assertNotNull(builder.build(work("Expand",null,proposal,scope)).clarification());
    }
    @Test void byteBudgetIncludesJsonArrayBracketsAndSeparatorsAtTheExactBoundary() {
        pair(1,scope,"answer");
        var first=messages.getFirst();var last=messages.getLast();
        int firstSize=json.writeValueAsBytes(new MemoryEntry(first.id(),"USER_INPUT","x".repeat(2000))).length;
        int overhead=json.writeValueAsBytes(new MemoryEntry(last.id(),"MODEL_EXPLANATION","x")).length-1;
        int remaining=CanvasFollowupContext.MAX_HISTORY_BYTES-firstSize-overhead;
        assertTrue(remaining>0 && remaining<=2000);
        messages.set(0,new Message(first.id(),first.clientRequestId(),1,"USER","COMPLETED",caller,"x".repeat(2000),List.of(),null,null,Instant.now(),Instant.now()));
        messages.set(1,new Message(last.id(),last.clientRequestId(),2,"ASSISTANT","COMPLETED",null,"x".repeat(remaining),null,null,null,Instant.now(),Instant.now()));
        var memory=builder.build(work("More",null,null,scope)).memory();
        assertEquals(1,memory.history().size(),"Two entries fit only if JSON framing is incorrectly excluded");
        assertTrue(json.writeValueAsBytes(memory.history()).length<=CanvasFollowupContext.MAX_HISTORY_BYTES);
    }

}
