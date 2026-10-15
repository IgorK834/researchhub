package dev.researchhub.analysis.api;

import dev.researchhub.security.application.CostlyOperation;
import dev.researchhub.security.application.CostCategory;
import dev.researchhub.analysis.application.*;
import dev.researchhub.analysis.application.AnalysisContracts.*;
import dev.researchhub.auth.application.CurrentUserResolver;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;
import java.net.URI;
import java.util.*;

@RestController
@RequestMapping("/api/workspaces/{workspaceId}/analyses")
public class AnalysisController {
    @org.springframework.beans.factory.annotation.Autowired private ProblemService problems;
    @org.springframework.beans.factory.annotation.Autowired private ParameterRunService parameterRuns;
    @org.springframework.beans.factory.annotation.Autowired private SolutionService solutions;
    @org.springframework.beans.factory.annotation.Autowired private tools.jackson.databind.ObjectMapper json;
    private final AnalysisService analyses;
    private final CurrentUserResolver users;
    private final ExecutionService executions;
    private final AnalysisReproductionService reproduction;
    public AnalysisController(AnalysisService analyses,CurrentUserResolver users,ExecutionService executions,AnalysisReproductionService reproduction) {
        this.analyses=analyses; this.users=users; this.executions=executions;this.reproduction=reproduction;
    }
    @PostMapping ResponseEntity<?> create(@PathVariable UUID workspaceId,@RequestBody tools.jackson.databind.JsonNode body) {
        try {
        Object result;
        if(body.has("schemaVersion")) {
            if(!body.path("schemaVersion").asString().equals("2.0"))throw new IllegalArgumentException("Unsupported analysis contract");
            if(body.path("workload").asString().equals("PROBLEM"))result=problems.create(workspaceId,users.requireCurrentUser().id(),json.rebuild().enable(tools.jackson.databind.DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES,tools.jackson.databind.DeserializationFeature.FAIL_ON_TRAILING_TOKENS)
                .disable(tools.jackson.databind.MapperFeature.ALLOW_COERCION_OF_SCALARS).disable(tools.jackson.databind.DeserializationFeature.ACCEPT_FLOAT_AS_INT)
                .withCoercionConfig(tools.jackson.databind.type.LogicalType.Textual,cfg->{for(var shape:List.of(tools.jackson.databind.cfg.CoercionInputShape.Integer,tools.jackson.databind.cfg.CoercionInputShape.Float,tools.jackson.databind.cfg.CoercionInputShape.Boolean))cfg.setCoercion(shape,tools.jackson.databind.cfg.CoercionAction.Fail);}).build().treeToValue(body,ProblemContracts.Create.class));
            else if(body.path("workload").asString().equals("DATASET")) {dev.researchhub.shared.math.MathAst.fields(body,"schemaVersion","workload","userPrompt","inputs");result=analyses.create(workspaceId,users.requireCurrentUser().id(),new Create(body.path("userPrompt").asString(),java.util.Arrays.asList(json.treeToValue(body.path("inputs"),Input[].class))));}
            else throw new IllegalArgumentException("Unsupported workload");
        } else result=analyses.create(workspaceId,users.requireCurrentUser().id(),json.treeToValue(body,Create.class));
        UUID id=result instanceof ProblemContracts.Analysis p?p.id():((Analysis)result).id();
        return ResponseEntity.created(URI.create("/api/workspaces/"+workspaceId+"/analyses/"+id))
            .cacheControl(CacheControl.noStore()).body(result);
        }catch(IllegalArgumentException | tools.jackson.core.JacksonException invalid){throw new dev.researchhub.shared.error.ApiException(dev.researchhub.shared.error.ApiErrorCode.VALIDATION_FAILED,"Invalid analysis request");}
    }
    @GetMapping ResponseEntity<?> list(@PathVariable UUID workspaceId,@RequestParam(defaultValue="0") int offset) {
        return ok(analyses.list(workspaceId,users.requireCurrentUser().id(),offset).stream().map(a->problems.isProblem(workspaceId,a.id())?(Object)problems.find(workspaceId,users.requireCurrentUser().id(),a.id()):a).toList());
    }
    @GetMapping("/{analysisId}") ResponseEntity<?> find(@PathVariable UUID workspaceId,@PathVariable UUID analysisId) {
        return ok(problems.isProblem(workspaceId,analysisId)?problems.find(workspaceId,users.requireCurrentUser().id(),analysisId):analyses.find(workspaceId,users.requireCurrentUser().id(),analysisId));
    }
    @CostlyOperation(value = CostCategory.ANALYSIS, access = CostlyOperation.Access.EDIT)
    @PostMapping("/{analysisId}/plan") ResponseEntity<?> plan(@PathVariable UUID workspaceId,@PathVariable UUID analysisId) {
        return ok(problems.isProblem(workspaceId,analysisId)?problems.plan(workspaceId,users.requireCurrentUser().id(),analysisId):analyses.plan(workspaceId,users.requireCurrentUser().id(),analysisId));
    }
    @GetMapping("/{analysisId}/plans") ResponseEntity<?> attempts(@PathVariable UUID workspaceId,@PathVariable UUID analysisId) {
        return ok(problems.isProblem(workspaceId,analysisId)?Optional.ofNullable(problems.find(workspaceId,users.requireCurrentUser().id(),analysisId).audit()).stream().toList():analyses.attempts(workspaceId,users.requireCurrentUser().id(),analysisId));
    }
    @CostlyOperation(value = CostCategory.ANALYSIS, access = CostlyOperation.Access.EDIT)
    @PostMapping("/{analysisId}/execute") ResponseEntity<?> execute(@PathVariable UUID workspaceId,@PathVariable UUID analysisId) {
        if(problems.isProblem(workspaceId,analysisId)) {
            var result=problems.enqueue(workspaceId,users.requireCurrentUser().id(),analysisId);
            return ResponseEntity.accepted().cacheControl(CacheControl.noStore()).body(result);
        }
        var execution=executions.enqueue(workspaceId,users.requireCurrentUser().id(),analysisId);
        return ResponseEntity.accepted().location(URI.create("/api/workspaces/"+workspaceId+"/analyses/"+analysisId+"/executions/"+execution.id()))
            .cacheControl(CacheControl.noStore()).body(execution);
    }
    @GetMapping("/{analysisId}/executions") ResponseEntity<?> executions(@PathVariable UUID workspaceId,@PathVariable UUID analysisId) {
        return ok(problems.isProblem(workspaceId,analysisId)?problems.executions(workspaceId,users.requireCurrentUser().id(),analysisId):executions.list(workspaceId,users.requireCurrentUser().id(),analysisId));
    }
    @GetMapping("/{analysisId}/executions/{executionId}") ResponseEntity<?> execution(
        @PathVariable UUID workspaceId,@PathVariable UUID analysisId,@PathVariable UUID executionId) {
        return ok(problems.isProblem(workspaceId,analysisId)?problems.execution(workspaceId,users.requireCurrentUser().id(),analysisId,executionId):executions.find(workspaceId,users.requireCurrentUser().id(),analysisId,executionId));
    }
    @GetMapping("/{analysisId}/executions/{executionId}/artifacts/{artifactId}") ResponseEntity<byte[]> artifact(
        @PathVariable UUID workspaceId,@PathVariable UUID analysisId,@PathVariable UUID executionId,@PathVariable UUID artifactId) {
        var content=executions.artifact(workspaceId,users.requireCurrentUser().id(),analysisId,executionId,artifactId);
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).contentType(MediaType.parseMediaType(content.artifact().mediaType()))
            .contentLength(content.artifact().sizeBytes()).header(HttpHeaders.CONTENT_DISPOSITION,
                ContentDisposition.attachment().filename(content.artifact().filename()).build().toString())
            .header("X-Content-Type-Options","nosniff").header("Content-Security-Policy","sandbox; default-src 'none'").body(content.bytes());
    }
    @GetMapping("/{analysisId}/executions/{executionId}/record") ResponseEntity<?> record(
        @PathVariable UUID workspaceId,@PathVariable UUID analysisId,@PathVariable UUID executionId) {
        if(problems.isProblem(workspaceId,analysisId)){var a=problems.find(workspaceId,users.requireCurrentUser().id(),analysisId);var e=problems.execution(workspaceId,users.requireCurrentUser().id(),analysisId,executionId);var record=new LinkedHashMap<String,Object>();record.put("schemaVersion","2.0");record.put("workload","PROBLEM");record.put("snapshot",a.snapshot());record.put("plan",a.plan());record.put("audit",a.audit());record.put("parentAnalysisId",a.parentAnalysisId());record.put("execution",e);return ok(record);}
        return ok(executions.record(workspaceId,users.requireCurrentUser().id(),analysisId,executionId));
    }
    @GetMapping("/{analysisId}/executions/{executionId}/solution") ResponseEntity<SolutionContracts.Bundle> solution(
        @PathVariable UUID workspaceId,@PathVariable UUID analysisId,@PathVariable UUID executionId) {
        return ok(solutions.find(workspaceId,users.requireCurrentUser().id(),analysisId,executionId));
    }
    @CostlyOperation(value = CostCategory.ANALYSIS, access = CostlyOperation.Access.EDIT)
    @PostMapping("/{analysisId}/executions/{executionId}/rerun") ResponseEntity<ReproductionContracts.RerunResult> rerun(
        @PathVariable UUID workspaceId,@PathVariable UUID analysisId,@PathVariable UUID executionId,@RequestBody Map<String,Object> body) {
        if (body==null || !body.keySet().equals(Set.of("inputMode")) || !(body.get("inputMode") instanceof String mode))
            throw new dev.researchhub.shared.error.ApiException(dev.researchhub.shared.error.ApiErrorCode.VALIDATION_FAILED,"Only the original/latest input mode is accepted");
        ReproductionContracts.InputMode inputMode;
        try { inputMode=ReproductionContracts.InputMode.valueOf(mode); }
        catch (IllegalArgumentException invalid) { throw new dev.researchhub.shared.error.ApiException(dev.researchhub.shared.error.ApiErrorCode.VALIDATION_FAILED,"Use ORIGINAL or LATEST inputs"); }
        var command=new ReproductionContracts.Rerun(inputMode);
        var result=reproduction.rerun(workspaceId,users.requireCurrentUser().id(),analysisId,executionId,command);
        String location="/api/workspaces/"+workspaceId+"/analyses/"+result.analysisId();
        if (result.execution()!=null) location+="/executions/"+result.execution().id();
        return ResponseEntity.accepted().location(URI.create(location)).cacheControl(CacheControl.noStore()).body(result);
    }
    @GetMapping("/{analysisId}/parameters") ResponseEntity<?> parameters(@PathVariable UUID workspaceId,@PathVariable UUID analysisId) {
        return ok(parameterRuns.definitions(workspaceId,users.requireCurrentUser().id(),analysisId));
    }
    @PostMapping("/{analysisId}/runs") ResponseEntity<ParameterRunContracts.Result> parameterRun(@PathVariable UUID workspaceId,@PathVariable UUID analysisId,@RequestBody tools.jackson.databind.JsonNode body) {
        ParameterRunContracts.Run command;
        try {
            command=json.rebuild().enable(tools.jackson.databind.DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)
                .disable(tools.jackson.databind.MapperFeature.ALLOW_COERCION_OF_SCALARS).disable(tools.jackson.databind.DeserializationFeature.ACCEPT_FLOAT_AS_INT)
                .withCoercionConfig(tools.jackson.databind.type.LogicalType.Textual,cfg->{for(var shape:List.of(tools.jackson.databind.cfg.CoercionInputShape.Integer,tools.jackson.databind.cfg.CoercionInputShape.Float,tools.jackson.databind.cfg.CoercionInputShape.Boolean))cfg.setCoercion(shape,tools.jackson.databind.cfg.CoercionAction.Fail);}).build().treeToValue(body,ParameterRunContracts.Run.class);
        }catch(IllegalArgumentException|tools.jackson.core.JacksonException invalid){throw new dev.researchhub.shared.error.ApiException(dev.researchhub.shared.error.ApiErrorCode.VALIDATION_FAILED,"Invalid parameter run");}
        if(command==null)throw new dev.researchhub.shared.error.ApiException(dev.researchhub.shared.error.ApiErrorCode.VALIDATION_FAILED,"Invalid parameter run");
        var result=parameterRuns.run(workspaceId,users.requireCurrentUser().id(),analysisId,command);
        return ResponseEntity.accepted().cacheControl(CacheControl.noStore()).body(result);
    }
    @GetMapping("/{analysisId}/origin") ResponseEntity<ReproductionContracts.Origin> origin(
        @PathVariable UUID workspaceId,@PathVariable UUID analysisId) {
        return ok(new ReproductionContracts.Origin(analyses.origin(workspaceId,users.requireCurrentUser().id(),analysisId).orElse(null)));
    }
    @GetMapping("/{analysisId}/executions/{executionId}/provenance") ResponseEntity<ReproductionContracts.ComputationProvenance> provenance(
        @PathVariable UUID workspaceId,@PathVariable UUID analysisId,@PathVariable UUID executionId) {
        return ok(reproduction.provenance(workspaceId,users.requireCurrentUser().id(),analysisId,executionId));
    }
    @GetMapping("/{analysisId}/executions/{executionId}/code") ResponseEntity<ReproductionContracts.SavedCode> code(
        @PathVariable UUID workspaceId,@PathVariable UUID analysisId,@PathVariable UUID executionId) {
        return ok(reproduction.code(workspaceId,users.requireCurrentUser().id(),analysisId,executionId));
    }
    @CostlyOperation(value = CostCategory.ANALYSIS, access = CostlyOperation.Access.EDIT)
    @PostMapping("/{analysisId}/problem/executions/{executionId}/reproduce") ResponseEntity<?> reproduceProblem(@PathVariable UUID workspaceId,@PathVariable UUID analysisId,@PathVariable UUID executionId) {
        return ResponseEntity.accepted().cacheControl(CacheControl.noStore()).body(problems.reproduce(workspaceId,users.requireCurrentUser().id(),analysisId,executionId));
    }
    @GetMapping("/{analysisId}/problem/executions/{executionId}/artifacts/{name}") ResponseEntity<byte[]> problemArtifact(@PathVariable UUID workspaceId,@PathVariable UUID analysisId,@PathVariable UUID executionId,@PathVariable String name) {
        byte[] bytes=problems.artifact(workspaceId,users.requireCurrentUser().id(),analysisId,executionId,name);
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).contentType(MediaType.IMAGE_PNG).contentLength(bytes.length).header("X-Content-Type-Options","nosniff").header("Content-Security-Policy","sandbox; default-src 'none'").body(bytes);
    }
    private static <T> ResponseEntity<T> ok(T body) { return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(body); }
}
