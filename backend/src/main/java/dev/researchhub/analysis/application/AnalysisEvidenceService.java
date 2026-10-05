package dev.researchhub.analysis.application;

import dev.researchhub.ai.application.GenerationContracts;
import dev.researchhub.ai.application.RetrievalIdentity;
import dev.researchhub.shared.error.*;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Service;
import tools.jackson.databind.ObjectMapper;
import java.util.*;

/** Reads computed evidence from immutable successful outputs; never performs a calculation or runs code. */
@Service
@Profile("local")
public final class AnalysisEvidenceService {
    public record Reference(UUID analysisId,UUID executionId,String outputId) {
        public Reference {
            if (analysisId==null || executionId==null || outputId==null || outputId.isBlank() || outputId.length()>100)
                throw new IllegalArgumentException("Choose a saved analysis output");
        }
    }
    public record Citation(String evidenceId,UUID workspaceId,UUID analysisId,UUID executionId,String outputId,
        String title,String executionHash,String contentHash,String codeSha256,String executedAt,String runtimeVersion,
        List<ExecutionContracts.DatasetSnapshot> inputSources,String provenanceUrl,String detailsUrl,boolean truncated) {}
    public record Resolved(GenerationContracts.Evidence evidence,Citation citation) {}
    private final AnalysisReproductionService reproduction;
    private final ObjectMapper json;
    public AnalysisEvidenceService(AnalysisReproductionService reproduction,ObjectMapper json) { this.reproduction=reproduction;this.json=json; }
    public List<Resolved> resolve(UUID workspace,UUID caller,List<Reference> references) {
        if (references.size()>6 || new HashSet<>(references).size()!=references.size()) throw invalid();
        return references.stream().map(ref -> resolve(workspace,caller,ref)).toList();
    }
    private Resolved resolve(UUID workspace,UUID caller,Reference ref) {
        var record=reproduction.provenance(workspace,caller,ref.analysisId(),ref.executionId());
        if (record.status()!=ExecutionContracts.Status.SUCCEEDED || record.result()==null)
            throw new ConflictException("Computed evidence requires a saved successful execution result");
        int index=-1; for (int i=0;i<record.result().outputs().size();i++) if (record.result().outputs().get(i).name().equals(ref.outputId())) index=i;
        if (index<0) throw invalid();
        var output=record.result().outputs().get(index);
        Map<String,Object> data=new LinkedHashMap<>();
        data.put("kind",output.kind());data.put("name",output.name()); boolean truncated=false;
        if (output.kind()==dev.researchhub.analysis.application.AnalysisContracts.OutputKind.TABLE) {
            data.put("columns",output.columns());data.put("totalRows",output.rows().size());
            var rows=new ArrayList<List<Object>>();data.put("rows",rows);data.put("truncated",false);
            for (var row:output.rows()) { rows.add(row);if (json.writeValueAsString(data).length()>7200) { rows.removeLast();truncated=true;break; } }
            data.put("truncated",truncated);
        } else if (output.kind()==dev.researchhub.analysis.application.AnalysisContracts.OutputKind.TEXT) data.put("text",output.text());
        else data.put("chart",record.charts().stream().filter(chart -> chart.name().equals(output.name())).findFirst().orElseThrow(AnalysisEvidenceService::invalid));
        String content=json.writeValueAsString(data);
        if (content.length()>8000) throw new ApiException(ApiErrorCode.AI_CONTEXT_TOO_LARGE,"This output exceeds the evidence budget; select a smaller saved output");
        String id=RetrievalIdentity.hash("analysis-output:1:"+workspace+":"+ref.analysisId()+":"+ref.executionId()+":"+ref.outputId()+":"+record.executionHash());
        String hash=RetrievalIdentity.hash(content);
        var citation=new Citation(id,workspace,ref.analysisId(),ref.executionId(),ref.outputId(),record.planSummary(),record.executionHash(),hash,
            record.code().sha256(),record.executionTimestamp().toString(),record.runtimeVersion(),record.inputSources(),record.links().provenance(),record.outputReferences().get(index).detailsUrl(),truncated);
        return new Resolved(new GenerationContracts.Evidence(id,hash,content),citation);
    }
    private static ApiException invalid() { return new ApiException(ApiErrorCode.VALIDATION_FAILED,"Choose at most six distinct saved analysis outputs"); }
}
