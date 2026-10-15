package dev.researchhub.analysis.application;

import dev.researchhub.analysis.application.ProblemContracts.*;
import dev.researchhub.analysis.application.ParameterRunContracts.*;
import dev.researchhub.analysis.infrastructure.PostgresParameterRuns;
import dev.researchhub.security.application.*;
import dev.researchhub.shared.error.*;
import dev.researchhub.workspace.application.WorkspaceAuthorizationService;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.ObjectMapper;
import java.math.BigDecimal;
import java.time.Clock;
import java.util.*;

@Service
public class ParameterRunService {
    private static final String MIN="-1000000000000",MAX="1000000000000";
    private final ProblemService problems;private final ProblemStore store;private final PostgresParameterRuns runs;
    private final WorkspaceAuthorizationService access;private final ObjectMapper json;private final Clock clock;
    private final CostQuotaStore quota;private final Map<CostCategory,QuotaPolicy> policies;
    public ParameterRunService(ProblemService problems,ProblemStore store,PostgresParameterRuns runs,WorkspaceAuthorizationService access,ObjectMapper json,Clock clock,CostQuotaStore quota,@org.springframework.beans.factory.annotation.Qualifier("costQuotaPolicies") Map<CostCategory,QuotaPolicy> policies) {
        this.problems=problems;this.store=store;this.runs=runs;this.access=access;this.json=json;this.clock=clock;this.quota=quota;this.policies=policies;
    }
    public List<ParameterDefinition> definitions(UUID workspace,UUID user,UUID parent) {
        return problems.find(workspace,user,parent).snapshot().problem().parameters().stream()
            .map(p->new ParameterDefinition("1.0",p.symbol(),"DECIMAL",p.unit(),new Bounds(MIN,MAX),p.value(),true)).toList();
    }
    @Transactional
    public Result run(UUID workspace,UUID user,UUID parent,Run command) {
        access.requireContentEditor(workspace,user);
        var original=problems.find(workspace,user,parent);
        String hash=ProblemJson.hash(json,command);
        var existing=runs.existing(workspace,parent,user,command.idempotencyKey(),hash);
        if(existing.isPresent())return existing.get();
        if(original.plan()==null||!original.status().equals("READY_TO_EXECUTE"))throw new ConflictException("An approved plan is required; replanning is a separate model operation");
        var p=original.snapshot().problem();
        if(!command.parameters().keySet().equals(p.parameters().stream().map(Parameter::symbol).collect(java.util.stream.Collectors.toSet())))throw invalid();
        List<Parameter> parameters=new ArrayList<>();
        for(var parameter:p.parameters()) {
            var value=command.parameters().get(parameter.symbol());
            if(!"DECIMAL".equals(value.type())||!Objects.equals(parameter.unit(),value.unit()))throw invalid();
            try {ProblemContracts.decimal(value.value());var decimal=new BigDecimal(value.value());
                if(decimal.compareTo(new BigDecimal(MIN))<0||decimal.compareTo(new BigDecimal(MAX))>0)throw invalid();
                parameters.add(new Parameter(parameter.symbol(),value.value(),value.unit()));
            }catch(IllegalArgumentException bad){throw invalid();}
        }
        // Plot structure/output and units stay controlled by the approved AST. Only bounds/points may vary.
        Plot plot=command.plot()==null?p.plot():command.plot();
        if(command.plot()!=null&&(p.plot()==null||!p.plot().parameter().equals(plot.parameter())||!p.plot().output().equals(plot.output())))throw invalid();
        if(plot!=null&&(new BigDecimal(plot.start()).abs().compareTo(new BigDecimal(MAX))>0||new BigDecimal(plot.end()).abs().compareTo(new BigDecimal(MAX))>0))throw invalid();
        var problem=new Problem(p.statement(),parameters,p.unknowns(),p.domain(),p.expectedOutputs(),p.assumptions(),plot);
        if(!ProblemContracts.missing(problem).isEmpty())throw invalid();
        var input=new LinkedHashMap<String,Object>();input.put("problem",problem);input.put("origin",original.snapshot().origin());input.put("templateId",original.snapshot().templateId());input.put("templateHash",original.snapshot().templateHash());
        var snapshot=new Snapshot("2.0",problem,original.snapshot().origin(),ProblemJson.hash(json,input),original.snapshot().templateId(),original.snapshot().templateHash());
        if(ProblemJson.canonical(json,snapshot).getBytes(java.nio.charset.StandardCharsets.UTF_8).length>65536)
            throw new PayloadTooLargeException("Frozen problem context exceeds 64 KiB");
        var approved=original.plan();
        var plan=new Plan("2.0","PROBLEM",snapshot.inputHash(),approved.summary(),approved.outputs(),approved.assumptions(),approved.warnings(),List.of());
        try {ProblemPlanValidator.validate(problem,plan,snapshot.inputHash());}catch(IllegalArgumentException bad){throw invalid();}
        // Admission occurs after every type/unit/range/AST check and after the idempotency lookup.
        quota.admit(user,workspace,CostCategory.ANALYSIS,policies.get(CostCategory.ANALYSIS));
        var child=new Analysis("2.0","PROBLEM",UUID.randomUUID(),workspace,user,original.userPrompt(),"READY_TO_EXECUTE",snapshot,plan,null,List.of(),parent,clock.instant());
        var create=new Create("2.0","PROBLEM",UUID.nameUUIDFromBytes((workspace+":"+parent+":"+user+":"+command.idempotencyKey()).getBytes(java.nio.charset.StandardCharsets.UTF_8)),child.userPrompt(),problem,null,parent);
        child=store.create(child,create,hash);
        var execution=problems.enqueue(workspace,user,child.id());
        var result=new Result(parent,child.id(),execution.id(),"APPROVED_PLAN",0);
        runs.save(workspace,user,command.idempotencyKey(),hash,result);return result;
    }
    private static ApiException invalid(){return new ApiException(ApiErrorCode.VALIDATION_FAILED,"Use the defined decimal parameters, exact units, bounds and approved operations (solve degree 1–4)");}
}
