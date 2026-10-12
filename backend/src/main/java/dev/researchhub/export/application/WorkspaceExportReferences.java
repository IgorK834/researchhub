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
    private final dev.researchhub.analysis.application.SolutionService solutions;
    private final dev.researchhub.analysis.application.ProblemService problems;
    public WorkspaceExportReferences(UUID workspace,UUID caller,SourceService sources,ExecutionService executions) {
        this(workspace,caller,sources,executions,null,null);
    }
    public WorkspaceExportReferences(UUID workspace,UUID caller,SourceService sources,ExecutionService executions,
        dev.researchhub.analysis.application.SolutionService solutions,dev.researchhub.analysis.application.ProblemService problems) {
        this.workspace=workspace;this.caller=caller;this.sources=sources;this.executions=executions;this.solutions=solutions;this.problems=problems;
    }
    public SourceReference source(UUID sourceId,UUID versionId,String processingVersion,String chunkId,String citedContentHash,
                                  Integer pageStart,Integer pageEnd,String sectionTitle,List<Span> spans) {
        var source=sources.findOne(workspace,caller,sourceId);
        var version=versionId==null ? sources.activeVersion(workspace,caller,sourceId) : sources.findVersion(workspace,caller,sourceId,versionId);
        var metadata = source.bibliography();
        var frozen = new BibliographicMetadata(metadata.title(), metadata.authors(), metadata.publicationYear(),
                metadata.doi(), metadata.venue(), metadata.url(), metadata.citationKey());
        return new SourceReference(sourceId,version.id(),version.versionNumber(),
            metadata.title() == null ? source.displayName() : metadata.title(),version.contentSha256(),
            processingVersion,chunkId,citedContentHash,pageStart,pageEnd,sectionTitle,spans,frozen);
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
    @Override public List<Block> analysis(UUID a,UUID e,String output,String mode,String caption,String workload,UUID step,UUID conversation) {
        if(!"PROBLEM".equals(workload))return analysis(a,e,output,mode,caption);
        var b=solutions.find(workspace,caller,a,e);
        var provenance=solutionProvenance(b,output,step,conversation);
        var result=new ArrayList<Block>();
        switch(mode) {
            case "INPUTS" -> {
                require(output.equals("solution") && step==null);
                result.add(paragraph(b.statement(),false));
                b.inputs().forEach(p -> result.add(paragraph(p.symbol()+" = "+p.value()+" "+p.unit(),false)));
                b.unknowns().forEach(u -> result.add(paragraph("Unknown: "+u.symbol()+" ["+u.unit()+"]",false)));
            }
            case "STEP","SOLUTION" -> {
                require(output.equals("solution") && (mode.equals("STEP") == (step!=null)));
                var steps=mode.equals("STEP") ? b.steps().stream().filter(v -> v.id().equals(step.toString())).toList() : b.steps();
                require(!steps.isEmpty());
                for(var v:steps) {
                    var sp=solutionProvenance(b,output,UUID.fromString(v.id()),conversation);
                    result.add(new Heading(3,List.of(new Text(v.outputId()+" — "+v.operation(),Set.of()))));
                    result.add(new Equation("AST",dev.researchhub.shared.math.MathAst.notation(v.expression()),ReportMath.freeze(v.expression()),sp));
                    for(var property:v.substitution().properties()) {
                        var x=property.getValue();result.add(paragraph(property.getKey()+" = "+x.path("value").asString()+" "+x.path("unit").asString()+"; SI = "+x.path("siValue").asString(),false));
                    }
                    result.add(paragraph("Result: "+v.values()+" "+v.unit()+". Arithmetic CHECKED; interpretation NOT_CHECKED.",false));
                }
            }
            case "ASSUMPTIONS" -> {
                require(output.equals("solution") && step==null);
                result.add(paragraph("Interpretation NOT_CHECKED: "+b.interpretation().summary(),false));
                b.interpretation().assumptions().forEach(v -> result.add(paragraph("Assumption NOT_CHECKED: "+v,false)));
                b.interpretation().warnings().forEach(v -> result.add(paragraph("Warning: "+v,false)));
            }
            case "TABLE" -> {
                require(output.equals("plot-data") && step==null && !b.plot().isNull());
                var plot=b.plot();var rows=new ArrayList<List<Cell>>();
                rows.add(List.of(cell(plot.path("parameter").asString()+" ["+plot.path("xUnit").asString()+"]",true),cell(plot.path("output").asString()+" ["+plot.path("yUnit").asString()+"]",true)));
                for(var p:plot.path("points"))rows.add(List.of(cell(p.get(0).asString(),false),cell(p.get(1).asString(),false)));
                result.add(new Table(rows,caption,provenance));
            }
            case "CHART" -> {
                require(output.equals("plot") && step==null && !b.plot().isNull());
                result.add(ReportImages.normalize(problems.artifact(workspace,caller,a,e,"plot.png"),"image/png","Saved native plot",caption,provenance));
            }
            default -> throw EditorReportAdapter.invalid("Unsupported saved solution render mode");
        }
        if(!caption.isBlank() && !Set.of("TABLE","CHART").contains(mode))result.add(paragraph("Human caption: "+caption,true));
        result.add(paragraph(ReportText.provenance(provenance),true));
        return List.copyOf(result);
    }
    private static AnalysisProvenance solutionProvenance(dev.researchhub.analysis.application.SolutionContracts.Bundle b,String output,UUID step,UUID conversation) {
        return new AnalysisProvenance(b.analysisId(),b.executionId(),output,b.codeHashes().get("problem.py"),List.of(),
            new SolutionProvenance(b.inputHash(),b.planHash(),b.candidateHash(),b.imageId(),b.runtimeVersion(),b.codeHashes(),
                b.verificationVersion(),b.precision(),b.domain(),b.receipt(),step,conversation,"CHECKED","NOT_CHECKED"));
    }
    private static void require(boolean valid) {if(!valid)throw EditorReportAdapter.invalid("Saved solution reference does not match its immutable output/step");}
    private static Paragraph paragraph(String text,boolean caption) {return new Paragraph(List.of(new Text(text,Set.of())),caption);}
    private static Cell cell(String text,boolean header) {
        return new Cell(header,1,1,List.of(new Paragraph(List.of(new Text(text,Set.of())),false)));
    }
}
