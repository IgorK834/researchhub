package dev.researchhub.export;

import dev.researchhub.export.application.*;
import dev.researchhub.export.domain.Report;
import dev.researchhub.export.infrastructure.PostgresExportStore;
import dev.researchhub.support.DispatcherRaceDatabase;
import dev.researchhub.workspace.application.WorkspaceAuthorizationService;
import org.junit.jupiter.api.RepeatedTest;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import java.sql.Timestamp;
import java.time.Duration;
import java.util.*;
import static org.mockito.Mockito.mock;

class ExportDispatcherRaceIntegrationTest extends DispatcherRaceDatabase {
    protected void registerDispatcher(AnnotationConfigApplicationContext context) {
        context.registerBean(PostgresExportStore.class);
        context.registerBean(ExportService.class, () -> new ExportService(null, null, mock(WorkspaceAuthorizationService.class), null, null,
                context.getBean(PostgresExportStore.class), (report, format) -> { record(UUID.fromString(report.title())); return new byte[]{1,2,3}; }, json, clock, Duration.ofDays(7)));
        context.registerBean(ExportDispatcher.class, () -> new ExportDispatcher(context.getBean(PostgresExportStore.class), context.getBean(ExportService.class), clock, true));
    }
    @RepeatedTest(20) void threeDispatchersRenderTwoHundredExportsExactlyOnce() throws Exception {
        var expected = new HashSet<UUID>();
        for (int i = 0; i < 200; i++) {
            UUID id = UUID.randomUUID(); expected.add(id);
            var report = new Report("1.0", workspace, document, 1, id.toString(), clock.instant(), List.of(), List.of(), List.of(), List.of());
            jdbc.update("""
                INSERT INTO report_exports(id,workspace_id,document_id,requested_by,revision,format,status,filename,warnings,snapshot,created_at,expires_at)
                VALUES (?,?,?,?,1,'PDF','QUEUED','race.pdf','[]',?::jsonb,?,?)
                """, id, workspace, document, user, json.writeValueAsString(report), Timestamp.from(clock.instant()), Timestamp.from(clock.instant().plusSeconds(3600)));
        }
        race(context -> context.getBean(ExportDispatcher.class).dispatchAvailable());
        assertExactlyOnce(expected, "report_exports");
    }
}
