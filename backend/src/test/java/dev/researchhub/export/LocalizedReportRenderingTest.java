package dev.researchhub.export;

import dev.researchhub.export.application.ReportText;
import dev.researchhub.export.domain.*;
import dev.researchhub.export.domain.Report.*;
import dev.researchhub.export.infrastructure.AcademicReportRenderer;
import dev.researchhub.shared.localization.ContentLanguage;
import org.junit.jupiter.api.Test;
import java.io.*;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
import static dev.researchhub.export.ReportFixtures.*;

class LocalizedReportRenderingTest {
    @Test void localeUsesBundledCslAndChangesOnlyLabelsNotScientificValuesOrSourceTitles() throws Exception {
        var original=rich();var renderer=new AcademicReportRenderer(JSON);
        for(var locale:ContentLanguage.values())for(var style:CitationStyle.values()) {
            var report=new Report(original.schemaVersion(),original.workspaceId(),original.documentId(),original.revision(),original.title(),style,original.capturedAt(),original.blocks(),original.bibliography(),original.origins(),original.warnings(),locale);
            assertEquals(original.blocks(),report.blocks());assertEquals(original.bibliography(),report.bibliography());
            assertEquals(report,JSON.readValue(JSON.writeValueAsBytes(report),Report.class));
            String label=locale.choose("References","Bibliografia");
            try(var word=new org.apache.poi.xwpf.usermodel.XWPFDocument(new ByteArrayInputStream(renderer.render(report,ExportFormat.DOCX)))) {
                String text=word.getParagraphs().stream().map(p->p.getText()).collect(java.util.stream.Collectors.joining(" "));
                assertTrue(text.contains(label));assertTrue(text.contains("Kowalski"));
                assertTrue(text.contains(locale.choose("p. 3–4","s. 3–4")),text);
            }
            try(var pdf=org.apache.pdfbox.Loader.loadPDF(renderer.render(report,ExportFormat.PDF))) {
                String text=new org.apache.pdfbox.text.PDFTextStripper().getText(pdf);assertTrue(text.contains(label));assertTrue(text.contains("0.612"));
            }
            var files=LatexReportRenderingTest.unzip(renderer.render(report,ExportFormat.LATEX));String tex=LatexReportRenderingTest.tex(files);
            assertTrue(tex.contains("\\section*{"+label+"}"));assertTrue(tex.contains("0.612"));assertTrue(tex.contains(original.bibliography().getFirst().source().title()));
            assertEquals(original.withExportLanguage(locale).exportLanguage(),locale);
        }
        var historical=(tools.jackson.databind.node.ObjectNode)JSON.valueToTree(original);historical.remove("exportLanguage");
        assertEquals(ContentLanguage.EN,JSON.treeToValue(historical,Report.class).exportLanguage());
    }
    @Test void provenanceTranslatesDescriptionsWhileKeepingFrozenIdentifiersAndPrecision() {
        assertEquals("",ReportText.provenance(null,ContentLanguage.PL));
        var p=new AnalysisProvenance(UUID.randomUUID(),UUID.randomUUID(),"0.612","a".repeat(64),List.of());
        assertEquals(ReportText.provenance(p),ReportText.provenance(p,ContentLanguage.EN));assertTrue(ReportText.provenance(p,ContentLanguage.PL).contains("wykonanie"));assertTrue(ReportText.provenance(p,ContentLanguage.PL).contains("0.612"));
        var s=new SolutionProvenance("a".repeat(64),"b".repeat(64),"c".repeat(64),"image","runtime",Map.of("solve","d".repeat(64)),"v1",JSON.readTree("{\"absolute\":\"0.001\"}"),"REAL",null,UUID.randomUUID(),UUID.randomUUID(),"CHECKED","NOT_CHECKED");
        var solution=new AnalysisProvenance(p.analysisId(),p.executionId(),p.outputId(),p.codeSha256(),List.of(),s);
        String text=ReportText.provenance(solution,ContentLanguage.PL);assertTrue(text.contains("precyzja"));assertTrue(text.contains("0.001"));assertTrue(text.contains(s.stepId().toString()));
    }
}
