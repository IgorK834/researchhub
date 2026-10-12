package dev.researchhub.analysis.application;

import dev.researchhub.ai.application.GenerationContracts;
import dev.researchhub.ai.application.RetrievalIdentity;
import dev.researchhub.shared.error.*;
import org.springframework.stereotype.Service;
import tools.jackson.databind.ObjectMapper;
import java.util.*;

/** Reads computed evidence from immutable successful outputs; never performs a calculation or runs code. */
@Service
public final class AnalysisEvidenceService {
    public record Reference(UUID analysisId,UUID executionId,String outputId) {
        public Reference {
            if (analysisId==null || executionId==null || outputId==null || outputId.isBlank() || outputId.length()>100)
                throw new IllegalArgumentException("Choose a saved analysis output");
        }
    }
    public record Citation(String evidenceId,UUID workspaceId,UUID analysisId,UUID executionId,String outputId,
        String title,String executionHash,String contentHash,String codeSha256,String executedAt,String runtimeVersion,
        List<ExecutionContracts.DatasetSnapshot> inputSources,String provenanceUrl,String detailsUrl,boolean truncated,
        @com.fasterxml.jackson.annotation.JsonInclude(com.fasterxml.jackson.annotation.JsonInclude.Include.NON_NULL) ProblemProvenance problem) {
        public Citation(String evidenceId,UUID workspaceId,UUID analysisId,UUID executionId,String outputId,String title,String executionHash,String contentHash,
            String codeSha256,String executedAt,String runtimeVersion,List<ExecutionContracts.DatasetSnapshot> inputSources,String provenanceUrl,String detailsUrl,boolean truncated) {
            this(evidenceId,workspaceId,analysisId,executionId,outputId,title,executionHash,contentHash,codeSha256,executedAt,runtimeVersion,inputSources,provenanceUrl,detailsUrl,truncated,null);
        }
    }
    public record ProblemProvenance(String schemaVersion,String workload,String inputHash,String planHash,
        String verificationVersion,String arithmeticStatus,String interpretationStatus,String domain,List<String> assumptions) {}
    public record Resolved(GenerationContracts.Evidence evidence,Citation citation) {}
    private final AnalysisReproductionService reproduction;
    private final ObjectMapper json;
    @org.springframework.beans.factory.annotation.Autowired private ProblemStore problems;
    @org.springframework.beans.factory.annotation.Autowired private dev.researchhub.workspace.application.WorkspaceAuthorizationService access;
    public AnalysisEvidenceService(AnalysisReproductionService reproduction,ObjectMapper json) { this.reproduction=reproduction;this.json=json; }
    public List<Resolved> resolve(UUID workspace,UUID caller,List<Reference> references) {
        if (references.size()>6 || new HashSet<>(references).size()!=references.size()) throw invalid();
        return references.stream().map(ref -> resolve(workspace,caller,ref)).toList();
    }
    private Resolved resolve(UUID workspace,UUID caller,Reference ref) {
        if(problems!=null && problems.find(workspace,ref.analysisId()).isPresent())return resolveProblem(workspace,caller,ref);
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
    private Resolved resolveProblem(UUID workspace,UUID caller,Reference ref) {
        access.requireContentReader(workspace,caller);
        var a=problems.find(workspace,ref.analysisId()).orElseThrow(AnalysisEvidenceService::invalid);
        var e=problems.execution(workspace,ref.analysisId(),ref.executionId()).orElseThrow(()->new ResourceNotFoundException("Computed execution was not found"));
        if(!e.status().equals("SUCCEEDED") || e.result()==null || e.verification()==null || !e.verification().status().equals("CHECKED"))
            throw new ConflictException("Computed evidence requires saved checked arithmetic");
        var data=new LinkedHashMap<String,Object>();
        data.put("workload","PROBLEM");data.put("arithmeticStatus","CHECKED");data.put("interpretationStatus","NOT_CHECKED");
        data.put("domain",a.snapshot().problem().domain());data.put("assumptions",a.snapshot().problem().assumptions());
        data.put("inputHash",e.inputHash());data.put("planHash",e.planHash());
        boolean truncated=false;
        switch(ref.outputId()) {
            case "solution" -> {
                if(e.solution()==null)throw invalid();
                data.put("kind","SOLUTION");data.put("inputs",e.solution().inputs());
                data.put("outputs",e.solution().outputs().deepCopy());
                // The bounded evidence keeps values, units and AST; full saved steps are available via the capability.
                for(var output:(tools.jackson.databind.node.ArrayNode)data.get("outputs"))((tools.jackson.databind.node.ObjectNode)output).remove("steps");
                data.put("stepReferences",e.solution().steps().stream().map(s->Map.of("id",s.id(),"outputId",s.outputId(),"check",s.check())).toList());
            }
            case "calculation" -> {data.put("kind","SOLUTION");data.put("outputs",e.result().path("outputs"));}
            case "plot-data", "plot" -> {
                if(e.result().path("plot").isNull())throw invalid();
                data.put("kind",ref.outputId().equals("plot")?"CHART":"TABLE");
                var plot=e.result().path("plot").deepCopy();
                var rows=(tools.jackson.databind.node.ArrayNode)plot.path("points");int count=rows.size();
                while(rows.size()>50)rows.remove(rows.size()-1);truncated=count>rows.size();
                data.put("plot",plot);data.put("totalPoints",count);data.put("truncated",truncated);
            }
            default -> throw invalid();
        }
        String content=json.writeValueAsString(data);
        if(content.length()>8000)throw new ApiException(ApiErrorCode.AI_CONTEXT_TOO_LARGE,"Select a smaller saved problem output");
        String executionHash=RetrievalIdentity.hash(e.inputHash()+":"+e.planHash()+":"+e.verification().candidateHash()+":"+e.imageId());
        String id=RetrievalIdentity.hash("problem-output:2:"+workspace+":"+ref.analysisId()+":"+ref.executionId()+":"+ref.outputId()+":"+executionHash);
        String hash=RetrievalIdentity.hash(content),url="/api/workspaces/"+workspace+"/analyses/"+a.id()+"/executions/"+e.id()+"/record";
        var citation=new Citation(id,workspace,a.id(),e.id(),ref.outputId(),a.plan().summary(),executionHash,hash,
            e.solution()==null?null:e.solution().codeHashes().get("problem.py"),e.completedAt().toString(),e.runtimeVersion(),List.of(),url,url,truncated,
            new ProblemProvenance("2.0","PROBLEM",e.inputHash(),e.planHash(),e.verification().receipt().path("schemaVersion").asString(),"CHECKED","NOT_CHECKED",a.snapshot().problem().domain(),a.snapshot().problem().assumptions()));
        return new Resolved(new GenerationContracts.Evidence(id,hash,content),citation);
    }
    private static ApiException invalid() { return new ApiException(ApiErrorCode.VALIDATION_FAILED,"Choose at most six distinct saved analysis outputs"); }
}
