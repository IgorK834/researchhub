package dev.researchhub.ai.application;

import dev.researchhub.ai.application.CanvasConversationContracts.*;
import dev.researchhub.document.application.DocumentProvenance;
import dev.researchhub.source.application.SourceReadScope;
import dev.researchhub.analysis.application.AnalysisEvidenceService;
import dev.researchhub.shared.error.*;
import org.springframework.stereotype.Component;
import tools.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import java.util.*;

/** History is untrusted memory. Only the new scope can supply factual evidence. */
@Component
public class CanvasFollowupContext {
    public static final int MAX_HISTORY_MESSAGES=6,MAX_HISTORY_BYTES=4096;
    private final ConversationStore conversations;private final CanvasTurnStore turns;private final CanvasContextService contexts;
    private final AuthoringStore proposals;private final DocumentProvenance provenance;private final SourceReadScope sources;
    private final AnalysisEvidenceService analyses;private final ObjectMapper json;
    public CanvasFollowupContext(ConversationStore conversations,CanvasTurnStore turns,CanvasContextService contexts,
        AuthoringStore proposals,DocumentProvenance provenance,SourceReadScope sources,AnalysisEvidenceService analyses,ObjectMapper json) {
        this.conversations=conversations;this.turns=turns;this.contexts=contexts;this.proposals=proposals;this.provenance=provenance;this.sources=sources;this.analyses=analyses;this.json=json;
    }
    public record Built(Memory memory,String clarification) {}
    public Built build(Work work) {
        var request=work.request();var context=contexts.find(work.workspaceId(),work.documentId(),work.callerId(),request.contextId());
        var saved=conversations.history(work.workspaceId(),work.conversationId(),null,25);
        var prior=saved.messages().stream().filter(m->m.sequence()<work.claim().user().sequence()).toList();
        var states=turns.history(work.workspaceId(),work.conversationId(),prior.stream().filter(m->"USER".equals(m.role())).map(ConversationContracts.Message::id).toList());
        var safeRequests=new HashSet<UUID>();
        for(var state:states) if(request.scope().sourceVersionIds().containsAll(state.scope().sourceVersionIds()) && request.scope().analysisOutputs().containsAll(state.scope().analysisOutputs())) {
            sources.requireSourceVersions(work.workspaceId(),work.callerId(),state.scope().sourceVersionIds());
            analyses.resolve(work.workspaceId(),work.callerId(),state.scope().analysisOutputs());
            prior.stream().filter(m->m.id().equals(state.messageId())).forEach(m->safeRequests.add(m.clientRequestId()));
        }
        String clarification=null;
        if(request.replyToMessageId()!=null && prior.stream().noneMatch(m->m.id().equals(request.replyToMessageId()) && "COMPLETED".equals(m.status()) && safeRequests.contains(m.clientRequestId())))
            clarification="The referenced message is unavailable in this evidence scope. Select the intended message or sources.";
        String lower=request.instruction().toLowerCase(Locale.ROOT);
        if(request.targetProposalId()==null && (lower.contains("proposal") || lower.contains("propozyc") || lower.contains("inserted text") || lower.contains("wstawion")))
            clarification="Choose the proposal to expand, or select the current inserted text and change context.";
        if((lower.contains("that result") || lower.contains("ten wynik") || lower.contains("that chart") || lower.contains("ten wykres"))
            && request.scope().analysisOutputs().size()!=1 && context.snapshot().analyses().size()!=1 && request.replyToMessageId()==null)
            clarification="Select the saved result you mean before continuing.";
        String proposalText=null;List<UUID> applied=List.of();String selected=context.snapshot().text();
        if(request.targetProposalId()!=null) {
            var proposal=proposals.find(work.workspaceId(),work.documentId(),request.targetProposalId(),false);
            if(!Set.of("PENDING","ACCEPTED").contains(proposal.state()))throw new ConflictException("The referenced proposal is no longer available");
            if(proposal.citations().stream().anyMatch(c->!request.scope().sourceVersionIds().contains(c.sourceVersionId())))
                clarification="The proposal uses sources outside the current scope. Select those sources explicitly or change context.";
            else if("ACCEPTED".equals(proposal.state())) {
                var blocks=provenance.appliedBlocks(work.workspaceId(),work.callerId(),work.documentId(),proposal.id());
                applied=List.copyOf(blocks.keySet());selected=head(blocks.values().stream().map(CanvasFollowupContext::plain).collect(java.util.stream.Collectors.joining("\n")),4000);
            } else proposalText=head(proposal.generatedText(),4000);
        }
        var history=new ArrayList<MemoryEntry>();int bytes=2; // JSON array brackets count toward the worker boundary.
        // Never copy old citation objects, snippets, or output payloads. Scope narrowing drops the whole pair.
        for(var m:prior.reversed()) {
            if(!"COMPLETED".equals(m.status()) || !safeRequests.contains(m.clientRequestId()))continue;
            String content=head(m.content(),2000);
            var entry=new MemoryEntry(m.id(),"USER".equals(m.role())?"USER_INPUT":"MODEL_EXPLANATION",content);
            int size=json.writeValueAsBytes(entry).length+(history.isEmpty()?0:1);
            if(history.size()==MAX_HISTORY_MESSAGES || bytes+size>MAX_HISTORY_BYTES)break;
            history.addFirst(entry);bytes+=size;
        }
        // An explicitly referenced older message must be included, otherwise ask rather than guess.
        if(request.replyToMessageId()!=null && history.stream().noneMatch(m->m.messageId().equals(request.replyToMessageId())))
            clarification="The referenced message is outside the bounded conversation memory. Restate the request or choose a recent message.";
        var memory=new Memory("1.0",request.contextId(),work.documentId(),request.instruction(),selected,context.snapshot().before(),context.snapshot().after(),
            request.targetProposalId(),proposalText,applied,history,prior.size()-history.size());
        return new Built(memory,clarification);
    }
    public MemorySummary summary(Memory m) {return new MemorySummary("1.0",m.history().size(),m.omittedMessages(),RetrievalIdentity.hash(json.writeValueAsString(m)));}
    public static String head(String s,int limit) {int end=Math.min(s.length(),limit);if(end<s.length() && end>0 && Character.isHighSurrogate(s.charAt(end-1)))end--;return s.substring(0,end);}
    private static String plain(tools.jackson.databind.JsonNode node) {
        if("text".equals(node.path("type").asString()))return node.path("text").asString();
        var text=new StringBuilder();for(var child:node.path("content"))text.append(plain(child));return text.toString();
    }
}
