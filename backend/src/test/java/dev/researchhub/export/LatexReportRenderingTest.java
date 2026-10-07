package dev.researchhub.export;

import dev.researchhub.export.domain.ExportFormat;
import dev.researchhub.export.domain.Report;
import dev.researchhub.export.domain.Report.*;
import dev.researchhub.export.infrastructure.AcademicReportRenderer;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.TimeUnit;
import java.util.zip.ZipInputStream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.apache.pdfbox.Loader;
import org.apache.pdfbox.text.PDFTextStripper;
import static dev.researchhub.export.ReportFixtures.*;
import static org.junit.jupiter.api.Assertions.*;

class LatexReportRenderingTest {
    static Map<String, byte[]> unzip(byte[] bytes) throws IOException {
        var result = new LinkedHashMap<String, byte[]>();
        try (var zip = new ZipInputStream(new ByteArrayInputStream(bytes), StandardCharsets.UTF_8)) {
            for (var entry = zip.getNextEntry(); entry != null; entry = zip.getNextEntry()) {
                assertFalse(entry.isDirectory());
                assertFalse(entry.getName().startsWith("/"));
                assertFalse(entry.getName().contains(".."));
                assertFalse(entry.getName().contains("\\"));
                assertNull(result.put(entry.getName(), zip.readAllBytes()), "Duplicate ZIP path");
            }
        }
        return result;
    }
    static String tex(Map<String, byte[]> files) { return new String(files.get("report.tex"), StandardCharsets.UTF_8); }
    static byte[] render(Report report) { return new AcademicReportRenderer(JSON).render(report, ExportFormat.LATEX); }

    @Test void packagesUtf8TexVerifiedPngAndTheCompleteFrozenProvenanceDeterministically() throws Exception {
        var report = rich();
        byte[] bytes = render(report);
        var files = unzip(bytes);
        assertEquals(Set.of("report.tex", "README.txt", "report.json", "images/figure-001.png"), files.keySet());
        assertArrayEquals(png(), files.get("images/figure-001.png"));
        assertEquals(report, JSON.readValue(files.get("report.json"), Report.class));
        assertArrayEquals(bytes, render(report));
        String tex = tex(files);
        assertTrue(tex.contains("Zażółć gęślą jaźń"));
        assertTrue(tex.contains("\\includegraphics[width=\\linewidth,height=0.72\\textheight,keepaspectratio]{images/figure-001.png}"));
        assertTrue(tex.contains("Figure 1. Impedance"));
        assertTrue(tex.contains("[1, p. 3-4]"));
        assertTrue(tex.contains("\\section*{References}"));
        assertTrue(tex.contains(V.toString()));
        assertTrue(tex.contains("code SHA-256: " + "d".repeat(64)));
        assertTrue(tex.contains("\\begin{enumerate}[start=3]"));
        assertEquals("application/zip", ExportFormat.LATEX.mediaType());
        assertEquals("zip", ExportFormat.LATEX.extension());
        writeBundle(Path.of("target/export-qa/latex/rich"), files);
    }

    static Report hostile() {
        String attack = "\\input{/etc/passwd} & 50% $ # _ ~ ^ { }\r\nZażółć\tΩ\u0000";
        var source = new SourceReference(S, V, 2, attack, "a".repeat(64), "extract:2", null, null,
            null, null, attack, List.of());
        var image = (Image) rich().blocks().get(4);
        var provenance = new AnalysisProvenance(W, D, attack, "d".repeat(64), List.of(source));
        var blocks = new ArrayList<Block>();
        for (int level = 1; level <= 6; level++) blocks.add(new Heading(level, List.of(text(attack))));
        blocks.add(new Paragraph(List.of(new Text(attack, EnumSet.allOf(Style.class)), new Citation(1, source)), true));
        blocks.add(new Image(image.pngBase64(), image.width(), image.height(), attack, "", provenance));
        blocks.add(new Image(image.pngBase64(), image.width(), image.height(), "", attack, null));
        blocks.add(new Code("\\end{verbatim}\n\\end{document}\n\\write18{touch injected}"));
        blocks.add(new Equation(attack, "\\input{missing-equation} E=mc^2"));
        blocks.add(new ListBlock(false, 1, List.of()));
        blocks.add(new ListBlock(true, 1, List.of(List.of())));
        blocks.add(new Container(List.of(paragraph(attack)), false));
        return new Report("1.0", W, D, 3, attack, NOW, blocks, List.of(new BibliographyEntry(1, source)),
            rich().origins(), List.of(attack));
    }

    @Test void escapesEveryTextContextAndNeverUsesUserTextAsCommandsOrAssetPaths() throws Exception {
        var files = unzip(render(hostile()));
        String tex = tex(files);
        assertTrue(tex.contains("\\textbackslash{}input\\{/etc/passwd\\} \\& 50\\% \\$ \\# \\_ \\textasciitilde{} \\textasciicircum{} \\{ \\}"));
        for (String command : List.of("\\input{", "\\write18{", "\\end{verbatim}", "missing-equation}")) assertFalse(tex.contains(command), command);
        assertEquals(1, tex.split("\\\\end\\{document\\}", -1).length - 1);
        assertFalse(tex.contains("\u0000"));
        assertTrue(tex.contains("\\newline{}"));
        assertEquals(1, files.keySet().stream().filter(name -> name.endsWith(".png")).count(), "Repeated figures share one local asset");
        assertTrue(tex.contains("\\section*{Export notes}"));
        writeBundle(Path.of("target/export-qa/latex/escaped"), files);
    }

    static Report merged() {
        var table = new Table(List.of(
            List.of(new Cell(true, 2, 2, List.of(paragraph("MERGED CELL"))), cell("Header C", true)),
            List.of(cell("Second row C", false)),
            List.of(cell("A", false), cell("B", false), cell("C", false))), "Merged table", null);
        var nested = new Table(List.of(List.of(new Cell(false, 1, 1, List.of(paragraph("Before nested table"), table,
            (Image) rich().blocks().get(4), new ListBlock(false, 1, List.of(List.of(paragraph("Cell item")))))))), "Nested results", null);
        var allHeaders = new Table(List.of(List.of(cell("Only header", true))), "", null);
        Block deepList = paragraph("Deeply nested item");
        for (int i = 0; i < 8; i++) deepList = new ListBlock(i % 2 == 0, 1, List.of(List.of(deepList)));
        return report(List.of(table, nested, allHeaders, deepList));
    }

    @Test void preservesMergedNestedAndLongTablesAndDeepLists() throws Exception {
        String tex = tex(unzip(render(merged())));
        assertTrue(tex.contains("\\multicolumn{2}"));
        assertTrue(tex.contains("\\multirow[t]{2}{=}"));
        assertTrue(tex.contains("\\begin{tabular}"));
        assertTrue(tex.contains("\\\\*"), "Keep multirow groups together on one page");
        assertTrue(tex.contains("MERGED CELL"));
        assertTrue(tex.contains("Second row C"));
        assertTrue(tex.contains("Deeply nested item"));
        writeBundle(Path.of("target/export-qa/latex/merged"), unzip(render(merged())));
        var rows = new ArrayList<List<Cell>>();
        rows.add(List.of(cell("Measurement", true), cell("Value", true)));
        for (int i = 0; i < 150; i++) rows.add(List.of(cell("Row " + i, false), cell("Value " + i, false)));
        var longReport = report(List.of(new Table(rows, "Long results", null)));
        tex = tex(unzip(render(longReport)));
        assertTrue(tex.contains("\\endhead"));
        assertTrue(tex.contains("Row 149"));
        writeBundle(Path.of("target/export-qa/latex/long"), unzip(render(longReport)));
    }

    @Test void permitsEmptyReportsWithoutInventingBibliographyOrWarnings() throws Exception {
        var report = new Report("1.0", W, D, 1, "", NOW, List.of(), List.of(), List.of(), List.of());
        String tex = tex(unzip(render(report)));
        assertFalse(tex.contains("\\section*{References}"));
        assertFalse(tex.contains("\\section*{Export notes}"));
        assertTrue(tex.endsWith("\\end{document}\n"));
    }

    static void writeBundle(Path directory, Map<String, byte[]> files) throws IOException {
        for (var entry : files.entrySet()) {
            Path file = directory.resolve(entry.getKey());
            Files.createDirectories(file.getParent());
            Files.write(file, entry.getValue());
        }
    }

    /** Test-only validation with an installed Tectonic engine. Product runtime has no compiler dependency. */
    @Test @EnabledIfEnvironmentVariable(named="LATEX_TEST_COMPILER", matches=".+")
    void representativeSourcesActuallyCompileWithChartsAndEscapedCommands() throws Exception {
        for (var entry : Map.of("compiled-rich", rich(), "compiled-escaped", hostile(), "compiled-merged", merged()).entrySet()) {
            Path directory = Path.of("target/export-qa/latex", entry.getKey()).toAbsolutePath();
            writeBundle(directory, unzip(render(entry.getValue())));
            var log = directory.resolve("compiler.log");
            var process = new ProcessBuilder(System.getenv("LATEX_TEST_COMPILER"), "--untrusted", "--keep-logs", "report.tex")
                .directory(directory.toFile()).redirectErrorStream(true).redirectOutput(log.toFile()).start();
            if (!process.waitFor(90, TimeUnit.SECONDS)) { process.destroyForcibly(); fail("LaTeX validation exceeded its deadline"); }
            assertEquals(0, process.exitValue(), Files.readString(log));
            assertFalse(Files.exists(directory.resolve("injected")));
            try (var pdf = Loader.loadPDF(Files.readAllBytes(directory.resolve("report.pdf")))) {
                assertTrue(pdf.getNumberOfPages() > 0);
                String text = new PDFTextStripper().getText(pdf);
                assertTrue(text.contains("Zażółć") || text.contains("MERGED CELL"));
                boolean image = false;
                for (var page : pdf.getPages()) if (page.getResources().getXObjectNames().iterator().hasNext()) image = true;
                assertTrue(image, "TeX must include the packaged figure");
            }
        }
    }
}
