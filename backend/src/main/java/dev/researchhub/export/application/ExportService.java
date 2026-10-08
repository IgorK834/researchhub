package dev.researchhub.export.application;

import dev.researchhub.analysis.application.ExecutionService;
import dev.researchhub.document.application.DocumentService;
import dev.researchhub.document.application.DocumentProvenance;
import dev.researchhub.document.domain.StaleRevisionException;
import dev.researchhub.export.domain.*;
import dev.researchhub.export.domain.Report.*;
import dev.researchhub.source.application.SourceService;
import dev.researchhub.workspace.application.WorkspaceAuthorizationService;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.*;
import tools.jackson.databind.*;
import java.nio.charset.StandardCharsets;
import java.time.*;
import java.util.*;

@Service
public class ExportService {
    private final DocumentService documents;
    private final DocumentProvenance provenance;
    private final WorkspaceAuthorizationService authorization;
    private final SourceService sources;
    private final ExecutionService executions;
    private final ExportStore store;
    private final ReportRenderer renderer;
    private final ObjectMapper json;
    private final Clock clock;
    private final Duration retention;
    public ExportService(DocumentService documents,DocumentProvenance provenance,WorkspaceAuthorizationService authorization,
                         SourceService sources,ExecutionService executions,ExportStore store,ReportRenderer renderer,
                         ObjectMapper json,Clock clock,@Value("${researchhub.export.retention:PT168H}") Duration retention) {
        if (retention.isNegative() || retention.isZero() || retention.compareTo(Duration.ofDays(30))>0)
            throw new IllegalArgumentException("Export retention must be between zero and 30 days");
        this.documents=documents;this.provenance=provenance;this.authorization=authorization;this.sources=sources;
        this.executions=executions;this.store=store;this.renderer=renderer;this.json=json;this.clock=clock;this.retention=retention;
    }
    /** A coherent revision and its provenance are frozen before expensive rendering is dispatched. */
    @Transactional(isolation=Isolation.REPEATABLE_READ)
    public ExportJob enqueue(UUID workspace,UUID caller,UUID document,ExportFormat format,long revision) {
        var detail=documents.findOne(workspace,caller,document);
        if (revision!=detail.summary().revision()) throw new StaleRevisionException(detail.summary().revision(),revision);
        var origins=new ArrayList<Origin>();
        collectOrigins(json.readTree(detail.content()),workspace,caller,document,origins,0);
        var report=new EditorReportAdapter(json).convert(workspace,document,revision,detail.summary().title(),detail.content(),clock.instant(),
            new WorkspaceExportReferences(workspace,caller,sources,executions),origins);
        // Reject malformed or impractically wide tables before creating a durable job.
        validateTables(report.blocks());
        if (json.writeValueAsString(report).getBytes(StandardCharsets.UTF_8).length>24*1024*1024)
            throw new dev.researchhub.shared.error.PayloadTooLargeException("Export snapshot exceeds 24 MiB");
        Instant now=clock.instant();
        var job=new ExportJob(UUID.randomUUID(),workspace,document,caller,revision,format,ExportJob.Status.QUEUED,
            ExportFilename.of(report.title(),format),report.warnings(),now,null,null,now.plus(retention),null,null,0);
        return store.enqueue(job,report);
    }
    public ExportJob find(UUID workspace,UUID caller,UUID document,UUID job) {
        authorization.requireContentReader(workspace,caller);return store.find(workspace,document,job);
    }
    public Report report(UUID workspace,UUID caller,UUID document,UUID job) {
        requireUnexpired(find(workspace,caller,document,job));return store.report(workspace,document,job);
    }
    public ExportJob.Download download(UUID workspace,UUID caller,UUID document,UUID job) {
        requireUnexpired(find(workspace,caller,document,job));return store.download(workspace,document,job);
    }
    private void requireUnexpired(ExportJob job) {
        if (!clock.instant().isBefore(job.expiresAt()))
            throw new dev.researchhub.shared.error.ConflictException("Export has expired; generate it again");
    }
    public void execute(ExportJob.Claimed claimed) {
        String failure=null;byte[] bytes=null;
        try {
            authorization.requireContentReader(claimed.job().workspaceId(),claimed.job().requestedBy());
            bytes=renderer.render(claimed.report(),claimed.job().format());
            if (bytes.length==0 || bytes.length>32*1024*1024) { bytes=null;failure="OUTPUT_TOO_LARGE"; }
            authorization.requireContentReader(claimed.job().workspaceId(),claimed.job().requestedBy());
        } catch (dev.researchhub.shared.error.ApiException denied) { bytes=null;failure="ACCESS_REVOKED"; }
        catch (RuntimeException failed) {
            bytes=null;failure="RENDER_FAILED";
            org.slf4j.LoggerFactory.getLogger(getClass()).atWarn().addKeyValue("event","export.render.failed")
                .addKeyValue("jobId",claimed.job().id()).addKeyValue("errorType",failed.getClass().getSimpleName()).log("Report export failed");
        }
        store.complete(claimed.job().id(),bytes,failure,clock.instant());
    }
    private void collectOrigins(JsonNode node,UUID workspace,UUID caller,UUID document,List<Origin> result,int depth) {
        if (depth>64) throw EditorReportAdapter.invalid("Document exceeds nesting limit");
        var blockId=node.path("attrs").path("blockId");
        if (blockId.isString()) {
            UUID block=EditorReportAdapter.uuid(node.path("attrs"),"blockId");
            var history=provenance.inspect(workspace,caller,document,block);
            if (!history.isEmpty()) {
                var o=history.getFirst();result.add(new Origin(block,o.id(),o.category().name(),o.actorUserId(),o.actorName(),
                    o.sourceOperationId(),o.documentRevision(),o.createdAt(),json.writeValueAsString(o.metadata())));
            }
        }
        for (var child:node.path("content")) collectOrigins(child,workspace,caller,document,result,depth+1);
    }
    private void validateTables(List<Block> blocks) {
        for (var block:blocks) {
            if (block instanceof Table t) {
                try { TableGrid.of(t); } catch (IllegalArgumentException invalid) { throw EditorReportAdapter.invalid(invalid.getMessage()); }
                t.rows().forEach(row -> row.forEach(cell -> validateTables(cell.blocks())));
            } else if (block instanceof Container c) validateTables(c.blocks());
            else if (block instanceof ListBlock l) l.items().forEach(this::validateTables);
        }
    }
}
