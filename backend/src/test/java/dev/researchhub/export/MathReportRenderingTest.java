package dev.researchhub.export;

import dev.researchhub.export.domain.Report;
import dev.researchhub.export.domain.Report.*;
import dev.researchhub.export.application.*;
import dev.researchhub.export.infrastructure.*;
import dev.researchhub.analysis.application.*;
import org.junit.jupiter.api.Test;
import org.apache.pdfbox.Loader;
import org.apache.pdfbox.rendering.PDFRenderer;
import org.apache.pdfbox.text.PDFTextStripper;
import java.io.*;
import java.nio.file.*;
import java.util.*;
import java.util.zip.*;
import javax.imageio.ImageIO;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static dev.researchhub.export.ReportFixtures.*;

class MathReportRenderingTest {
    @Test void oversizedExponentsCannotWrapIntoSupportedNotation() {
        for (String exponent : List.of("-9223372036854775808", "9223372036854775807", "18446744073709551616", "-2147483648", "-9")) {
            var expression=ast("{\"op\":\"pow\",\"base\":{\"op\":\"number\",\"value\":\"2\"},\"exponent\":"+exponent+"}");
            assertThrows(IllegalArgumentException.class,()->ReportMath.freeze(expression));
            assertThrows(IllegalArgumentException.class,()->ReportMath.omml(expression));
        }
    }
    static tools.jackson.databind.JsonNode ast(String value) {return JSON.readTree(value);}
    static final String FRACTION="""
        {"op":"div","left":{"op":"pow","base":{"op":"symbol","name":"R1"},"exponent":2},"right":{"op":"sqrt","arg":{"op":"number","value":"4"}}}
        """;
    @Test void sharedReportContractPreservesVerificationAndNativeProvenanceOnRead() throws Exception {
        var fixture=JSON.readValue(Files.readString(Path.of("../contracts/document/report/v2/report.json")),Report.class);
        assertEquals("2.0",fixture.schemaVersion());
        var equation=(Equation)fixture.blocks().get(2);assertEquals("CHECKED",equation.provenance().solution().arithmetic());
        assertEquals("NOT_CHECKED",equation.provenance().solution().interpretation());
        var ref=JSON.createObjectNode().put("analysisId",W.toString()).put("executionId",D.toString()).put("outputName","result").put("stepIndex",0).put("inputHash","a".repeat(64));
        var math=ReportMath.freeze(ast(FRACTION),ref);
        assertEquals(ref,JSON.readValue(JSON.writeValueAsBytes(math),MathExpression.class).verification());
    }
    @Test void controlledMathIsOfficeMathLocalRasterAndEditableTexAcrossPages() throws Exception {
        var math=ReportMath.freeze(ast(FRACTION));assertNull(math.warning());assertTrue(math.width()>0);
        var blocks=new ArrayList<Block>();
        blocks.add(new Paragraph(List.of(text("Inline equation: "),new InlineMath(math),text(" preserved suffix.")),false));
        for(int i=0;i<30;i++) {
            blocks.add(new Heading(2,List.of(text("Step "+i))));
            blocks.add(new Equation("AST",math.source(),math,null));
            blocks.add(paragraph("Substitution: R1 = 12 V; result = 72 mW. Arithmetic CHECKED; interpretation NOT_CHECKED."));
        }
        var report=new Report("2.0",W,D,3,"Frozen mathematical solution",NOW,blocks,List.of(),List.of(),List.of("Visible export warning"));
        assertEquals(report,JSON.readValue(JSON.writeValueAsBytes(report),Report.class));
        var docx=new DocxReportRenderer().render(report);var files=LatexReportRenderingTest.unzip(docx);
        String xml=new String(files.get("word/document.xml"),java.nio.charset.StandardCharsets.UTF_8);
        for(String tag:List.of("m:oMath","m:f","m:sSup","m:sSub","m:rad"))assertTrue(xml.contains(tag),tag+": "+xml);
        assertFalse(xml.contains("<m:oMath><m:oMath"),"OMML contains mathematical content, not a second document root");
        try(var word=new org.apache.poi.xwpf.usermodel.XWPFDocument(new ByteArrayInputStream(docx))) {
            assertEquals(1,word.getParagraphs().get(1).getCTP().getOMathArray(0).sizeOfFArray());
        }
        assertTrue(xml.contains("Visible export warning"));assertFalse(xml.contains("INCLUDEPICTURE"));
        var latex=LatexReportRenderingTest.unzip(new LatexReportRenderer(JSON).render(report));String tex=LatexReportRenderingTest.tex(latex);
        assertTrue(tex.contains("\\frac{"));assertTrue(tex.contains("\\mathrm{R}_{1}"));assertTrue(tex.contains("\\("));assertTrue(tex.contains("Step 29"));
        var pdf=new PdfReportRenderer().render(report);
        Path out=Path.of("target/export-qa");Files.createDirectories(out);
        Files.write(out.resolve("math-solution.docx"),docx);Files.write(out.resolve("math-solution.pdf"),pdf);Files.write(out.resolve("math-solution.zip"),new LatexReportRenderer(JSON).render(report));
        try(var document=Loader.loadPDF(pdf)) {
            assertTrue(document.getNumberOfPages()>2);String text=new PDFTextStripper().getText(document);
            assertTrue(text.contains("Step 29"));assertTrue(text.contains("72 mW"));assertTrue(text.contains("Visible export warning"));
            var renderer=new PDFRenderer(document);
            for(int page:List.of(0,document.getNumberOfPages()-1))ImageIO.write(renderer.renderImageWithDPI(page,110),"png",out.resolve("math-solution-page-"+page+".png").toFile());
        }
    }
    @Test void everyAllowedOperatorIsControlledAndHostileAndOversizedNotationIsNeverExecuted() throws Exception {
        for(String op:List.of("sin","cos","sqrt")) {
            var n=ast("{\"op\":\""+op+"\",\"arg\":{\"op\":\"number\",\"value\":\"4\"}}");
            assertNull(ReportMath.freeze(n).warning());assertTrue(ReportMath.omml(n).contains("m:r"));assertTrue(ReportMath.tex(n).contains("\\"+op));
        }
        for(String op:List.of("add","mul"))assertTrue(ReportMath.omml(ast("{\"op\":\""+op+"\",\"args\":[{\"op\":\"number\",\"value\":\"1\"},{\"op\":\"number\",\"value\":\"2\"}]}" )).contains("m:t"));
        assertTrue(ReportMath.tex(ast("{\"op\":\"eq\",\"left\":{\"op\":\"number\",\"value\":\"1\"},\"right\":{\"op\":\"symbol\",\"name\":\"x\"}}")).contains(" = "));
        assertThrows(IllegalArgumentException.class,()->ReportMath.freeze(ast("{\"op\":\"symbol\",\"name\":\"\\\\input{https://evil}\"}")));
        assertThrows(IllegalArgumentException.class,()->ReportMath.omml(ast("{\"op\":\"html\",\"value\":\"<script/>\"}")));
        var longAst=JSON.createObjectNode().put("op","add");var args=longAst.putArray("args");
        for(int i=0;i<8;i++)args.addObject().put("op","number").put("value","123456789012345678901234567890123456789");
        var fallback=ReportMath.freeze(longAst);assertNotNull(fallback.warning());assertNull(fallback.pngBase64());
        String hostile="\\input{https://evil} \\write18{echo danger} <script> \\alpha";
        var report=report(List.of(new Equation("UNKNOWN",hostile),new Equation("AST",fallback.source(),fallback,null),new Paragraph(List.of(new InlineMath(fallback)),false)));
        var tex=LatexReportRenderingTest.tex(LatexReportRenderingTest.unzip(new LatexReportRenderer(JSON).render(report)));
        assertFalse(tex.contains("\\input{"));assertFalse(tex.contains("\\write18{"));assertTrue(tex.contains("Ostrzeżenie"));assertTrue(tex.contains("alpha"));
        Path out=Path.of("target/export-qa");Files.createDirectories(out);
        byte[] pdfBytes=new PdfReportRenderer().render(report);
        Files.write(out.resolve("math-fallback.pdf"),pdfBytes);
        Files.write(out.resolve("math-fallback.docx"),new DocxReportRenderer().render(report));
        Files.write(out.resolve("math-fallback.zip"),new LatexReportRenderer(JSON).render(report));
        try(var pdf=Loader.loadPDF(pdfBytes)) {
            assertTrue(new PDFTextStripper().getText(pdf).contains("Ostrzeżenie"));
            ImageIO.write(new PDFRenderer(pdf).renderImageWithDPI(0,110),"png",out.resolve("math-fallback-page-0.png").toFile());
        }
        try(var word=new org.apache.poi.xwpf.usermodel.XWPFDocument(new ByteArrayInputStream(new DocxReportRenderer().render(report)))) {assertTrue(word.getParagraphs().stream().anyMatch(p->p.getText().contains("https://evil")));}
    }
    @Test void nativeSolutionReferenceKeepsFrozenInputsStepsReceiptAndNoFakeSourceVersion() throws Exception {
        var b=JSON.readValue(Files.readString(Path.of("../contracts/analysis/execution/v3/solution.json")),SolutionContracts.Bundle.class);
        var solutions=mock(SolutionService.class);var problems=mock(ProblemService.class);
        when(solutions.find(W,U,b.analysisId(),b.executionId())).thenReturn(b);
        var refs=new WorkspaceExportReferences(W,U,null,null,solutions,problems);
        for(String mode:List.of("INPUTS","STEP","SOLUTION","ASSUMPTIONS")) {
            var blocks=refs.analysis(b.analysisId(),b.executionId(),"solution",mode,"Human edited caption","PROBLEM",mode.equals("STEP") ? UUID.fromString(b.steps().getFirst().id()) : null,D);
            String snapshot=JSON.writeValueAsString(blocks);assertTrue(snapshot.contains(b.executionId().toString()));assertTrue(snapshot.contains(b.inputHash()));assertTrue(snapshot.contains("NOT_CHECKED"));assertFalse(snapshot.contains("sourceVersionId"));
            assertTrue(snapshot.contains("Human edited caption"));
            if(mode.equals("STEP"))assertTrue(snapshot.contains("siValue") || snapshot.contains("SI = 1"));
        }
        assertThrows(dev.researchhub.shared.error.ApiException.class,()->refs.analysis(b.analysisId(),b.executionId(),"solution","STEP","","PROBLEM",UUID.randomUUID(),D));
        assertThrows(dev.researchhub.shared.error.ApiException.class,()->refs.analysis(b.analysisId(),b.executionId(),"plot","CHART","","PROBLEM",null,null));
        assertThrows(dev.researchhub.shared.error.ApiException.class,()->refs.analysis(b.analysisId(),b.executionId(),"wrong","INPUTS","","PROBLEM",null,null));
        verifyNoInteractions(problems);
    }
}
