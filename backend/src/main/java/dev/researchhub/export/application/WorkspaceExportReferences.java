package dev.researchhub.export.application;

import dev.researchhub.analysis.application.ExecutionService;
import dev.researchhub.analysis.application.ExecutionContracts.Status;
import dev.researchhub.export.domain.Report.*;
import dev.researchhub.source.application.SourceService;
import dev.researchhub.shared.error.ConflictException;
import java.util.*;

/** Uses public source/analysis application APIs, including their workspace authorization. */
public final class WorkspaceExportReferences implements ExportReferences {
    private final UUID workspace,caller;
    private final SourceService sources;
    private final ExecutionService executions;
    public WorkspaceExportReferences(UUID workspace,UUID caller,SourceService sources,ExecutionService executions) {
        this.workspace=workspace;this.caller=caller;this.sources=sources;this.executions=executions;
    }
    public SourceReference source(UUID sourceId,UUID versionId,String processingVersion,String chunkId,String citedContentHash,
                                  Integer pageStart,Integer pageEnd,String sectionTitle,List<Span> spans) {
        var source=sources.findOne(workspace,caller,sourceId);
        var version=versionId==null ? sources.activeVersion(workspace,caller,sourceId) : sources.findVersion(workspace,caller,sourceId,versionId);
        return new SourceReference(sourceId,version.id(),version.versionNumber(),source.displayName(),version.contentSha256(),
            processingVersion,chunkId,citedContentHash,pageStart,pageEnd,sectionTitle,spans);
    }
    public List<Block> analysis(UUID analysisId,UUID executionId,String outputId,String renderMode,String caption) {
        var record=executions.record(workspace,caller,analysisId,executionId);
        var execution=record.execution();
        if (execution.status()!=Status.SUCCEEDED || execution.result()==null)
            throw new ConflictException("Export requires a saved successful analysis output");
        var output=execution.result().outputs().stream().filter(o -> o.name().equals(outputId)).findFirst()
            .orElseThrow(() -> EditorReportAdapter.invalid("Analysis output was not found"));
        String expected=switch (output.kind()) { case CHART -> "CHART";case TABLE -> "TABLE";case TEXT -> "SUMMARY"; };
        if (!expected.equals(renderMode)) throw EditorReportAdapter.invalid("Analysis render mode does not match the saved output");
        var inputs=record.snapshot().inputs().stream().map(i -> new SourceReference(i.sourceId(),i.sourceVersionId(),i.versionNumber(),
            i.originalFilename(),i.sha256(),null,null,null,null,null,
            i.sheets().stream().map(s -> s.name()).reduce((a,b) -> a+", "+b).orElse(null),List.of())).toList();
        var provenance=new AnalysisProvenance(analysisId,executionId,outputId,execution.provenance().codeSha256(),inputs);
        return switch (output.kind()) {
            case CHART -> {
                var artifact=executions.artifact(workspace,caller,analysisId,executionId,output.artifact().id());
                if (!dev.researchhub.analysis.application.ExecutionOutputValidator.sha256(artifact.bytes()).equals(output.artifact().sha256()))
                    throw new ConflictException("Saved chart failed its integrity check");
                try { yield List.of(ReportImages.normalize(artifact.bytes(),artifact.artifact().mediaType(),
                    output.chart()==null ? output.name() : output.chart().title(),caption,provenance)); }
                catch (IllegalArgumentException invalid) { throw EditorReportAdapter.invalid("Saved chart cannot be rendered"); }
            }
            case TABLE -> {
                var rows=new ArrayList<List<Cell>>();
                rows.add(output.columns().stream().map(c -> cell(c,true)).toList());
                output.rows().forEach(row -> rows.add(row.stream().map(c -> cell(c==null ? "" : c.toString(),false)).toList()));
                yield List.of(new Table(rows,caption,provenance));
            }
            case TEXT -> List.of(new Container(List.of(new Paragraph(List.of(new Text(output.text(),Set.of())),false),
                new Paragraph(List.of(new Text(caption,Set.of())),true),
                new Paragraph(List.of(new Text(ReportText.provenance(provenance),Set.of())),true)),false));
        };
    }
    private static Cell cell(String text,boolean header) {
        return new Cell(header,1,1,List.of(new Paragraph(List.of(new Text(text,Set.of())),false)));
    }
}
