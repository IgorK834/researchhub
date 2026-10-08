package dev.researchhub.ai.application;

import dev.researchhub.ai.application.GenerationContracts.*;
import dev.researchhub.ai.application.ContextContracts.*;
import dev.researchhub.shared.error.*;
import org.springframework.stereotype.Component;
import tools.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import java.util.*;

/** Packs already-authorized retrieval evidence; it never searches, tokenizes or calls a vendor. */
@Component
public class GroundedContextBuilder {
    public static final int FRAMING_RESERVE = 2048;
    private static final ObjectMapper JSON = new ObjectMapper();

    public ContextualRequest build(Request request, List<Citation> provenance, Budget budget) {
        return build(request,provenance,List.of(),budget);
    }
    public ContextualRequest build(Request request,List<Citation> provenance,
        List<dev.researchhub.analysis.application.AnalysisEvidenceService.Citation> computed,Budget budget) {
        GenerationContracts.require(provenance != null && provenance.size()+computed.size() == request.evidence().size());
        var text = new StringBuilder();
        var bindings = new ArrayList<Binding>();
        var firstTexts = new HashMap<String, String>();
        for (int index = 0; index < provenance.size(); index++) {
            var evidence = request.evidence().get(index); var citation = provenance.get(index);
            GenerationContracts.require(citation.chunkId().equals(evidence.chunkId()) && citation.contentHash().equals(evidence.contentHash()));
            GenerationContracts.require(citation.sourceId() != null && citation.workspaceId() != null);
            GenerationContracts.text(citation.title(), 255);
            String key = "S" + (index + 1);
            String reference = budget.collapseExactDuplicates() ? firstTexts.get(evidence.contentHash()) : null;
            firstTexts.putIfAbsent(evidence.contentHash(), key);
            // Keys are trusted delimiters. Everything from a source lives inside an escaped JSON object.
            var fields = new LinkedHashMap<String, Object>();
            fields.put("chunkId", citation.chunkId()); fields.put("sourceId", citation.sourceId());
            fields.put("title", citation.title()); fields.put("pageStart", citation.pageStart()); fields.put("pageEnd", citation.pageEnd());
            fields.put("sectionTitle", citation.sectionTitle()); fields.put("processingVersion", citation.processingVersion());
            fields.put("spans", citation.spans());
            fields.put("text", reference == null ? evidence.content() : null); fields.put("textReference", reference);
            if (!text.isEmpty()) text.append('\n');
            text.append('[').append(key).append("]\n").append(JSON.writeValueAsString(fields));
            bindings.add(new Binding(key, evidence.chunkId(), reference));
        }
        for (int index=0;index<computed.size();index++) {
            var citation=computed.get(index);var evidence=request.evidence().get(provenance.size()+index);
            GenerationContracts.require(citation.evidenceId().equals(evidence.chunkId()) && citation.contentHash().equals(evidence.contentHash()));
            var fields=new LinkedHashMap<String,Object>();
            fields.put("kind","ANALYSIS");fields.put("chunkId",citation.evidenceId());fields.put("analysisId",citation.analysisId());
            fields.put("executionId",citation.executionId());fields.put("outputId",citation.outputId());fields.put("title",citation.title());
            fields.put("executionHash",citation.executionHash());fields.put("executedAt",citation.executedAt());
            fields.put("text",evidence.content());fields.put("textReference",null);
            String key="A"+(index+1);if (!text.isEmpty()) text.append('\n');
            text.append('[').append(key).append("]\n").append(JSON.writeValueAsString(fields));
            bindings.add(new Binding(key,evidence.chunkId(),null));
        }
        String packed = text.toString();
        int contextBytes = bytes(packed);
        // Byte-based upper bound avoids a guessed words/4 tokenizer. Include the exact user JSON,
        // system text, schema/message framing reserve and completion-token reservation.
        var user = new LinkedHashMap<String, Object>(); user.put("instruction", request.instruction()); user.put("context", packed);
        long tokens = (long) bytes(request.systemInstruction()) + bytes(JSON.writeValueAsString(user)) + FRAMING_RESERVE + request.parameters().maxOutputTokens();
        if (contextBytes > budget.maxBytes() || tokens > budget.maxTokens()) throw overflow();
        var summary = new Summary(computed.isEmpty() ? "1.0" : "2.0", "utf8-conservative-v1", budget, RetrievalIdentity.hash(packed), contextBytes, tokens, bindings);
        var result = new ContextualRequest("2.0", request, new BuiltContext(summary, packed));
        if (JSON.writeValueAsBytes(result).length > 512 * 1024) throw overflow();
        return result;
    }
    private static int bytes(String value) { return value.getBytes(StandardCharsets.UTF_8).length; }
    private static ApiException overflow() {
        return new ApiException(ApiErrorCode.AI_CONTEXT_TOO_LARGE, "The selected evidence exceeds the context budget; select fewer or shorter chunks");
    }
}
