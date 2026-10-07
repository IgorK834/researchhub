package dev.researchhub.export;

import dev.researchhub.export.application.*;
import dev.researchhub.export.domain.*;
import dev.researchhub.export.domain.Report.*;
import dev.researchhub.export.infrastructure.*;
import org.junit.jupiter.api.Test;
import org.apache.poi.xwpf.usermodel.XWPFDocument;
import org.apache.pdfbox.Loader;
import org.apache.pdfbox.text.PDFTextStripper;
import java.io.*;
import java.nio.file.*;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
import static dev.researchhub.export.ReportFixtures.*;

class ReportRenderingTest {
    @Test void writesOfficeReadableDocxAndPaginatedPdfWithChartsCaptionsAndCitations() throws Exception {
        var report=rich();
        var renderer=new AcademicReportRenderer();
        byte[] docx=renderer.render(report,ExportFormat.DOCX),pdf=renderer.render(report,ExportFormat.PDF);
        try(var word=new XWPFDocument(new ByteArrayInputStream(docx))) {
            assertTrue(word.getParagraphs().stream().anyMatch(p -> "Heading1".equals(p.getStyle())));
            assertTrue(word.getParagraphs().stream().anyMatch(p -> p.getNumID()!=null));
            assertEquals(1,word.getTables().size());assertTrue(word.getTables().getFirst().getRow(0).isRepeatHeader());
            assertEquals(1,word.getAllPictures().size());
            String text=word.getParagraphs().stream().map(p -> p.getText()).reduce("",String::concat);
            assertTrue(text.contains("[1, p. 3-4]"));assertTrue(text.contains("Figure 1. Impedance"));assertTrue(text.contains("References"));
            assertTrue(text.contains(V.toString()));assertTrue(text.contains("SHA-256"));
        }
        try(var document=Loader.loadPDF(pdf)) {
            var text=new PDFTextStripper().getText(document);
            assertTrue(text.contains("Zażółć gęślą jaźń"),text);assertTrue(text.contains("Figure 1. Impedance"));
            assertTrue(text.contains("[1, p. 3-4]"));assertTrue(text.contains("Table 1. Measurements"));
            assertTrue(text.contains("0.612"));assertTrue(text.contains("References"));
            assertTrue(document.getPage(0).getResources().getFontNames().iterator().hasNext());
            boolean image=false;for(var page:document.getPages()) if(page.getResources().getXObjectNames().iterator().hasNext()) image=true;
            assertTrue(image,"Charts must be embedded, not omitted");
        }
        Files.createDirectories(Path.of("target/export-qa"));
        Files.write(Path.of("target/export-qa/report.docx"),docx);Files.write(Path.of("target/export-qa/report.pdf"),pdf);
    }
    @Test void paginatesLongTablesAndProseWithoutLosingTheFinalRowsOrBibliography() throws Exception {
        var blocks=new ArrayList<Block>();var rows=new ArrayList<List<Cell>>();
        rows.add(List.of(cell("Measurement",true),cell("Value",true)));
        for(int i=0;i<150;i++) rows.add(List.of(cell("Row "+i,false),cell("Value "+i,false)));
        blocks.add(new Table(rows,"Long results",null));
        for(int i=0;i<80;i++) blocks.add(paragraph("Paragraph "+i+": A repeated observation with a recorded method and measurement. ".repeat(4)));
        blocks.add(new Paragraph(List.of(text("LAST CONTENT"),new Citation(1,source())),false));
        byte[] bytes=new PdfReportRenderer().render(report(blocks));
        try(var pdf=Loader.loadPDF(bytes)) {
            assertTrue(pdf.getNumberOfPages()>8);String text=new PDFTextStripper().getText(pdf);
            assertTrue(text.contains("Row 149"));assertTrue(text.contains("LAST CONTENT"));assertTrue(text.contains("References"));
            assertTrue(text.indexOf("Measurement",text.indexOf("Measurement")+1)>0,"Table headers repeat on following pages");
        }
        Files.createDirectories(Path.of("target/export-qa"));Files.write(Path.of("target/export-qa/long-report.pdf"),bytes);
    }
    @Test void retainsMergedCellsNestedTablesAndEscapesMarkup() throws Exception {
        var table=new Table(List.of(List.of(new Cell(true,1,2,List.of(paragraph("Merged"))),cell("Header",true)),
            List.of(cell("<script>&\"' Safe",false))),"Merged caption",null);
        var container=new Table(List.of(List.of(new Cell(false,1,1,List.of(paragraph("Before nested table"),table)))),"",null);
        var report=report(List.of(table,container));
        byte[] docx=new DocxReportRenderer().render(report);
        try(var word=new XWPFDocument(new ByteArrayInputStream(docx))) {
            assertEquals("restart",word.getTables().getFirst().getRow(0).getCell(0).getCTTc().getTcPr().getVMerge().getVal().toString());
            assertEquals("continue",word.getTables().getFirst().getRow(1).getCell(0).getCTTc().getTcPr().getVMerge().getVal().toString());
            assertInstanceOf(org.apache.poi.xwpf.usermodel.XWPFParagraph.class,
                word.getTables().get(1).getRow(0).getCell(0).getBodyElements().getLast());
        }
        try(var pdf=Loader.loadPDF(new PdfReportRenderer().render(report))) {
            assertTrue(new PDFTextStripper().getText(pdf).contains("<script>&\"' Safe"));
        }
        var colspan=new Table(List.of(List.of(new Cell(true,2,1,List.of(paragraph("Spanning")))),List.of(cell("A",false),cell("B",false))),"",null);
        try(var word=new XWPFDocument(new ByteArrayInputStream(new DocxReportRenderer().render(report(List.of(colspan)))))) {
            assertEquals(1,word.getTables().getFirst().getRow(0).getTableCells().size());
            assertEquals(2,word.getTables().getFirst().getRow(0).getCell(0).getCTTc().getTcPr().getGridSpan().getVal().intValue());
        }
        assertThrows(IllegalArgumentException.class,() -> TableGrid.of(new Table(List.of(List.of(cell("a",false)),List.of(cell("a",false),cell("b",false))),"",null)));
        assertThrows(IllegalArgumentException.class,() -> TableGrid.of(new Table(List.of(),"",null)));
    }
    @Test void rasterizesSvgWithoutExternalResourcesAndRejectsInvalidOrOversizedImages() {
        String svg="<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"300\" height=\"200\"><rect width=\"300\" height=\"200\" fill=\"blue\"/></svg>";
        var image=ReportImages.normalize(svg.getBytes(),"image/svg+xml","SVG","Chart",null);
        assertEquals(300,image.width());assertEquals(200,image.height());
        assertThrows(IllegalArgumentException.class,() -> ReportImages.normalize(svg.replace("<rect","<script").getBytes(),"image/svg+xml","","",null));
        assertThrows(IllegalArgumentException.class,() -> ReportImages.normalize(svg.replace("fill=\"blue\"","fill=\"url(http://localhost/private)\"").getBytes(),"image/svg+xml","","",null));
        assertThrows(IllegalArgumentException.class,() -> ReportImages.normalize(new byte[0],"image/png","","",null));
        assertThrows(IllegalArgumentException.class,() -> ReportImages.normalize(new byte[9*1024*1024],"image/png","","",null));
        assertThrows(IllegalArgumentException.class,() -> ReportImages.normalize(new byte[]{1,2},"image/png","","",null));
        assertThrows(IllegalArgumentException.class,() -> ReportImages.normalize(png(),"text/html","","",null));
    }
}
