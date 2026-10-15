package dev.researchhub.analysis.application;

import dev.researchhub.analysis.application.ProblemContracts.*;
import dev.researchhub.analysis.application.ParameterRunContracts.*;
import dev.researchhub.analysis.infrastructure.PostgresParameterRuns;
import dev.researchhub.security.application.*;
import dev.researchhub.shared.error.*;
import dev.researchhub.workspace.application.WorkspaceAuthorizationService;
import org.junit.jupiter.api.*;
import tools.jackson.databind.*;
import java.time.*;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;

class ParameterRunServiceTest {
    ObjectMapper json=new ObjectMapper(); UUID workspace=UUID.randomUUID(),user=UUID.randomUUID(),parent=UUID.randomUUID(),key=UUID.randomUUID();
    ProblemService problems=mock(ProblemService.class);ProblemStore store=mock(ProblemStore.class);PostgresParameterRuns runs=mock(PostgresParameterRuns.class);
    WorkspaceAuthorizationService access=mock(WorkspaceAuthorizationService.class);CostQuotaStore quota=mock(CostQuotaStore.class);
    ParameterRunService service=new ParameterRunService(problems,store,runs,access,json,Clock.fixed(Instant.parse("2026-10-15T12:00:00Z"),ZoneOffset.UTC),quota,Map.of(CostCategory.ANALYSIS,new QuotaPolicy(10,30,Duration.ofMinutes(1))));
    Analysis original;Analysis child;
    @BeforeEach void setup() {
        var output=new Output("result","EVALUATE",json.readTree("{\"op\":\"symbol\",\"name\":\"x\"}"),"m");
        var p=new Problem("Calculate",List.of(new Parameter("x","2","m")),List.of(),"REAL",List.of(output),List.of(),new Plot("x","0","10",11,"result"));
        var snapshot=new Snapshot("2.0",p,null,"a".repeat(64),"problem-plan:2","b".repeat(64));
        original=new Analysis("2.0","PROBLEM",parent,workspace,user,"Calculate","READY_TO_EXECUTE",snapshot,new Plan("2.0","PROBLEM",snapshot.inputHash(),"Approved",p.expectedOutputs(),List.of(),List.of(),List.of()),null,List.of(),null,Instant.now());
        when(problems.find(workspace,user,parent)).thenAnswer(i->original);
        when(store.create(any(),any(),any())).thenAnswer(i->{child=i.getArgument(0);return child;});
        when(problems.enqueue(eq(workspace),eq(user),any())).thenAnswer(i->new Execution(UUID.randomUUID(),i.getArgument(2),"QUEUED",null,Instant.now(),null,null,null,child.snapshot().inputHash(),ProblemJson.hash(json,child.plan()),null,null));
    }
    Run command(String type,String value,String unit,Plot plot){return new Run(key,Map.of("x",new Value(type,value,unit)),ReproductionContracts.InputMode.ORIGINAL,plot);}
    @Test void createsLinkedImmutableSnapshotAndRebindsApprovedPlanWithoutPlanner() {
        String frozen=ProblemJson.canonical(json,original);
        var definitions=service.definitions(workspace,user,parent);assertEquals("DECIMAL",definitions.getFirst().type());assertTrue(definitions.getFirst().required());assertEquals("m",definitions.getFirst().unit());
        var run=service.run(workspace,user,parent,command("DECIMAL","3","m",new Plot("x","1","5",9,"result")));
        assertEquals(parent,run.parentAnalysisId());assertNotEquals(parent,run.analysisId());assertEquals(0,run.llmTokens());assertEquals("APPROVED_PLAN",run.mode());
        assertEquals(parent,child.parentAnalysisId());assertEquals("3",child.snapshot().problem().parameters().getFirst().value());assertNotEquals(original.snapshot().inputHash(),child.snapshot().inputHash());assertEquals(child.snapshot().inputHash(),child.plan().problemHash());
        assertEquals(original.plan().outputs(),child.plan().outputs());assertNull(child.audit());assertEquals(frozen,ProblemJson.canonical(json,original));
        verify(quota).admit(eq(user),eq(workspace),eq(CostCategory.ANALYSIS),any());verify(runs).save(eq(workspace),eq(user),eq(key),anyString(),eq(run));
    }
    @Test void idempotentRetryReturnsSameExecutionWithoutSecondAdmission() {
        var expected=new Result(parent,UUID.randomUUID(),UUID.randomUUID(),"APPROVED_PLAN",0);when(runs.existing(any(),any(),any(),any(),any())).thenReturn(Optional.of(expected));
        assertEquals(expected,service.run(workspace,user,parent,command("DECIMAL","3","m",null)));verifyNoInteractions(quota,store);
    }
    @Test void rejectsInvalidTypesUnitsCanonicalDecimalsAndBoundsBeforeAdmission() {
        for(var c:List.of(command("INTEGER","3","m",null),command("DECIMAL","3","cm",null),command("DECIMAL","1e2","m",null),command("DECIMAL","-0","m",null),command("DECIMAL","1.0","m",null),command("DECIMAL","1000000000001","m",null),command("DECIMAL","-1000000000001","m",null),new Run(key,Map.of(),ReproductionContracts.InputMode.ORIGINAL,null),new Run(key,Map.of("other",new Value("DECIMAL","3","m")),ReproductionContracts.InputMode.LATEST,null)))
            assertThrows(ApiException.class,()->service.run(workspace,user,parent,c));
        verifyNoInteractions(quota,store);
    }
    @Test void validatesPlotBoundsStructureAndNoReplan() {
        for(var plot:List.of(new Plot("x","0","1000000000001",3,"result"),new Plot("y","0","1",3,"result"),new Plot("x","0","1",3,"other")))assertThrows(ApiException.class,()->service.run(workspace,user,parent,command("DECIMAL","3","m",plot)));
        var p=original.snapshot().problem();var noPlot=new Problem(p.statement(),p.parameters(),p.unknowns(),p.domain(),p.expectedOutputs(),p.assumptions(),null);
        original=new Analysis(original.schemaVersion(),original.workload(),parent,workspace,user,original.userPrompt(),original.status(),new Snapshot("2.0",noPlot,null,"a".repeat(64),"problem-plan:2","b".repeat(64)),original.plan(),null,List.of(),null,Instant.now());
        assertThrows(ApiException.class,()->service.run(workspace,user,parent,command("DECIMAL","3","m",p.plot())));
        service.run(workspace,user,parent,command("DECIMAL","3","m",null));assertNull(child.snapshot().problem().plot());
    }
    @Test void requiresApprovedPlanAndAuthorizationBeforeDedupeOrAdmission() {
        original=new Analysis("2.0","PROBLEM",parent,workspace,user,"Draft","DRAFT",original.snapshot(),null,null,List.of(),null,Instant.now());
        assertThrows(ConflictException.class,()->service.run(workspace,user,parent,command("DECIMAL","3","m",null)));verifyNoInteractions(quota,store);
        doThrow(new ResourceNotFoundException("Unavailable")).when(access).requireContentEditor(workspace,user);
        assertThrows(ResourceNotFoundException.class,()->service.run(workspace,user,parent,command("DECIMAL","3","m",null)));
    }
    @Test void rejectsUnsupportedSolveAndMissingMetadataBeforeQuotaOrContainer() {
        var output=new Output("result","SOLVE",json.readTree("{\"op\":\"eq\",\"left\":{\"op\":\"pow\",\"base\":{\"op\":\"symbol\",\"name\":\"u\"},\"exponent\":5},\"right\":{\"op\":\"symbol\",\"name\":\"x\"}}"),"1");
        var p=new Problem("Solve",List.of(new Parameter("x","2","1")),List.of(new Unknown("u","1")),"REAL",List.of(output),List.of(),null);
        replaceProblem(p);
        assertThrows(ApiException.class,()->service.run(workspace,user,parent,command("DECIMAL","3","1",null)));
        p=new Problem(p.statement(),p.parameters(),p.unknowns(),null,p.expectedOutputs(),p.assumptions(),null);replaceProblem(p);
        assertThrows(ApiException.class,()->service.run(workspace,user,parent,command("DECIMAL","3","1",null)));verifyNoInteractions(quota,store);
    }
    void replaceProblem(Problem p) {original=new Analysis("2.0","PROBLEM",parent,workspace,user,"Solve","READY_TO_EXECUTE",new Snapshot("2.0",p,null,"a".repeat(64),"problem-plan:2","b".repeat(64)),new Plan("2.0","PROBLEM","a".repeat(64),"Plan",p.expectedOutputs(),p.assumptions(),List.of(),List.of()),null,List.of(),null,Instant.now());}
    @Test void rejectsMalformedRunContractsAndOutOfBoundsPlotStart() {
        assertThrows(IllegalArgumentException.class,()->new Run(null,Map.of(),ReproductionContracts.InputMode.ORIGINAL,null));
        assertThrows(IllegalArgumentException.class,()->new Run(key,null,ReproductionContracts.InputMode.ORIGINAL,null));
        assertThrows(IllegalArgumentException.class,()->new Run(key,Map.of(),null,null));
        var tooMany=new HashMap<String,Value>();for(int i=0;i<21;i++)tooMany.put("p"+i,new Value("DECIMAL","1","m"));
        assertThrows(IllegalArgumentException.class,()->new Run(key,tooMany,ReproductionContracts.InputMode.ORIGINAL,null));
        assertThrows(ApiException.class,()->service.run(workspace,user,parent,command("DECIMAL","3","m",new Plot("x","-1000000000001","0",3,"result"))));
        original=new Analysis("2.0","PROBLEM",parent,workspace,user,"Draft","DRAFT",original.snapshot(),original.plan(),null,List.of(),null,Instant.now());
        assertThrows(ConflictException.class,()->service.run(workspace,user,parent,command("DECIMAL","3","m",null)));verifyNoInteractions(quota,store);
    }

    @Test void rejectsOversizedFrozenContextBeforeAdmission() {
        var old=original.snapshot();var snapshot=new Snapshot(old.schemaVersion(),old.problem(),json.createObjectNode().put("context","x".repeat(65536)),old.inputHash(),old.templateId(),old.templateHash());
        original=new Analysis("2.0","PROBLEM",parent,workspace,user,"Approved","READY_TO_EXECUTE",snapshot,original.plan(),null,List.of(),null,Instant.now());
        assertThrows(PayloadTooLargeException.class,()->service.run(workspace,user,parent,command("DECIMAL","3","m",null)));verifyNoInteractions(quota,store);
    }

}
