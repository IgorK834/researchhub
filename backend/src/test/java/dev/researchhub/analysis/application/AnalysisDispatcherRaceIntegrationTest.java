package dev.researchhub.analysis.application;

import dev.researchhub.analysis.application.AnalysisContracts.*;
import dev.researchhub.analysis.application.ExecutionContracts.*;
import dev.researchhub.analysis.domain.AnalysisStatus;
import dev.researchhub.analysis.infrastructure.PostgresExecutionStore;
import dev.researchhub.audit.application.ProductAudit;
import dev.researchhub.source.application.*;
import dev.researchhub.support.DispatcherRaceDatabase;
import dev.researchhub.workspace.application.WorkspaceAuthorizationService;
import org.junit.jupiter.api.RepeatedTest;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.sql.Timestamp;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import static org.mockito.Mockito.*;

class AnalysisDispatcherRaceIntegrationTest extends DispatcherRaceDatabase {
    private final Map<UUID, Analysis> analyses = new ConcurrentHashMap<>();
    private final UUID source = UUID.randomUUID(), version = UUID.randomUUID();
    private final byte[] data = "x,y\n1,2\n".getBytes(StandardCharsets.UTF_8);
    private final String hash = ExecutionOutputValidator.sha256(data);
    protected void registerDispatcher(AnnotationConfigApplicationContext context) {
        context.registerBean(ProductAudit.class, () -> mock(ProductAudit.class));
        context.registerBean(PostgresExecutionStore.class);
        context.registerBean(ExecutionService.class, () -> {
            var analysisService = mock(AnalysisService.class);
            when(analysisService.find(any(), any(), any())).thenAnswer(call -> analyses.get(call.getArgument(2)));
            var sources = mock(SourceService.class);
            when(sources.findVersion(any(),any(),any(),any())).thenAnswer(call -> summary());
            when(sources.openVersionContent(any(),any(),any(),any())).thenAnswer(call -> new SourceVersionContent(summary(),new ByteArrayInputStream(data)));
            SandboxRunner runner = request -> {
                record(request.executionId());
                return new SandboxRunner.Result(true, null, 0, false, "", "", false, false, "sha256:"+"a".repeat(64), "1.1.1",
                        Map.of("result.json", "{\"schemaVersion\":\"1.0\",\"outputs\":[{\"name\":\"computed\",\"kind\":\"TABLE\",\"columns\":[\"y\"],\"rows\":[[2]]}]}".getBytes(StandardCharsets.UTF_8)));
            };
            return new ExecutionService(mock(WorkspaceAuthorizationService.class),analysisService,sources,context.getBean(PostgresExecutionStore.class),runner,json,clock);
        });
        context.registerBean(AnalysisExecutionDispatcher.class, () -> new AnalysisExecutionDispatcher(context.getBean(PostgresExecutionStore.class),context.getBean(ExecutionService.class),clock,true));
    }
    private SourceVersionSummary summary() {
        return new SourceVersionSummary(version,source,workspace,1,"data.csv","text/csv","CSV",data.length,hash,"READY",null,user,clock.instant(),clock.instant(),true);
    }
    @RepeatedTest(20) void threeDispatchersExecuteTwoHundredAnalysesExactlyOnce() throws Exception {
        analyses.clear(); var expected = new HashSet<UUID>(); var now = Timestamp.from(clock.instant());
        for (int i = 0; i < 200; i++) {
            UUID analysis = UUID.randomUUID(), planId = UUID.randomUUID(), id = UUID.randomUUID(); expected.add(id);
            var plan = new Plan("1.0","Compute",List.of(new PlanInput(version,"CSV",List.of(1,2))),List.of(),List.of(),
                    List.of(new Output(OutputKind.TABLE,"computed","Computed rows",List.of(version))),List.of(),List.of(),new Code("PYTHON","print('fixture')"));
            analyses.put(analysis,new Analysis(analysis,workspace,user,"Compute",AnalysisStatus.QUEUED,clock.instant(),clock.instant(),List.of(new Input(source,version,"CSV",List.of(1,2))),planId,plan,null));
            jdbc.update("INSERT INTO analyses(id,workspace_id,created_by,user_prompt,status,created_at,updated_at,inputs) VALUES (?,?,?,'Compute','DRAFT',?,?,'[{}]')",analysis,workspace,user,now,now);
            jdbc.update("INSERT INTO analysis_plan_attempts(id,analysis_id,workspace_id,attempt,payload,created_at) VALUES (?,?,?,1,'{}',?)",planId,analysis,workspace,now);
            jdbc.update("UPDATE analyses SET status='PLANNING' WHERE id=?",analysis);
            jdbc.update("UPDATE analyses SET status='READY_TO_EXECUTE',plan_id=?,plan=?::jsonb WHERE id=?",planId,json.writeValueAsString(plan),analysis);
            jdbc.update("UPDATE analyses SET status='QUEUED' WHERE id=?",analysis);
            var provenance = new Provenance(planId,ExecutionOutputValidator.sha256(json.writeValueAsString(plan)),ExecutionOutputValidator.sha256(plan.code().source()),List.of(new InputProvenance(source,version,"CSV",data.length,hash)),null,null);
            var queued = new Execution(id,analysis,workspace,user,1,Status.QUEUED,clock.instant(),null,null,provenance,null,null,null);
            jdbc.update("INSERT INTO analysis_executions(id,analysis_id,workspace_id,requested_by,attempt,status,payload,created_at) VALUES (?,?,?,?,1,'QUEUED',?::jsonb,?)",id,analysis,workspace,user,json.writeValueAsString(queued),now);
        }
        race(context -> context.getBean(AnalysisExecutionDispatcher.class).dispatchAvailable());
        assertExactlyOnce(expected,"analysis_executions");
    }
}
