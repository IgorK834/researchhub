package dev.researchhub.analysis.application;

import dev.researchhub.processing.application.SourceExtraction.ColumnSample;
import dev.researchhub.processing.application.SourceExtraction.PreviewRow;
import dev.researchhub.processing.application.SourceExtraction.SheetMetadata;
import dev.researchhub.processing.application.SourceExtraction.WorkbookMetadata;
import dev.researchhub.processing.infrastructure.WorkerJobResult;
import dev.researchhub.source.application.SourceVersionSummary;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * RH-131 projection rules. The three parity tests read the same fixtures as the Python worker's
 * {@code test_data_preview.py}; any difference between the two implementations fails one of them.
 */
class DatasetPreviewBuilderTest {
    private static final UUID VERSION = UUID.fromString("00000000-0000-4000-8000-0000000000a1");
    private static final Path CONTRACTS = Path.of("../contracts");
    private final ObjectMapper json = new ObjectMapper();

    private static SourceVersionSummary version(UUID source, String type, String filename) {
        return new SourceVersionSummary(VERSION, source, UUID.randomUUID(), 2, filename, "x/y", type, 2048,
                "ab".repeat(32), "READY", null, UUID.randomUUID(), Instant.EPOCH, Instant.EPOCH, true);
    }

    private JsonNode wire(DatasetPreview preview) throws Exception {
        return json.readTree(json.writeValueAsString(preview));
    }

    private JsonNode fixture(String name) throws Exception {
        return json.readTree(Files.readString(CONTRACTS.resolve("analysis/dataset-preview/v1").resolve(name)));
    }

    private WorkerJobResult processorFixture(String name) throws Exception {
        return json.readValue(Files.readString(CONTRACTS.resolve("processing/v4").resolve(name)), WorkerJobResult.class);
    }

    @Test
    void csvFixtureMatchesThePythonReferenceImplementation() throws Exception {
        var result = processorFixture("source-ingest-result-csv.json");
        var preview = DatasetPreviewBuilder.build(version(result.sourceId(), "CSV", "people.csv"), result.workbook(), json);
        assertEquals(fixture("csv-preview.json"), wire(preview));
    }

    @Test
    void workbookFixtureMatchesThePythonReferenceImplementation() throws Exception {
        var result = processorFixture("source-ingest-result-workbook.json");
        var preview = DatasetPreviewBuilder.build(version(result.sourceId(), "XLSX", "measurements.xlsx"),
                result.workbook(), json);
        assertEquals(fixture("xlsx-preview.json"), wire(preview));
    }

    @Test
    void cappedWorkbookMatchesThePythonReferenceImplementation() throws Exception {
        var workbook = json.readValue(Files.readString(CONTRACTS.resolve("analysis/dataset-preview/v1/large-workbook.json")),
                WorkbookMetadata.class);
        var source = UUID.fromString("018f1f7a-13a5-7d54-a210-57f87bbcf682");
        var preview = DatasetPreviewBuilder.build(version(source, "XLSX", "large.xlsx"), workbook, json);
        assertEquals(fixture("large-preview.json"), wire(preview));
        assertTrue(preview.truncated());
        assertEquals(DatasetPreviewBuilder.MAX_SHEETS, preview.sheets().size());
        assertTrue(json.writeValueAsBytes(preview).length < DatasetPreviewBuilder.MAX_RESPONSE_BYTES);
    }

    private static PreviewRow row(int number, String... cells) {
        return new PreviewRow(number, List.of(cells));
    }

    private static SheetMetadata sheet(String name, int columns, List<PreviewRow> rows, List<ColumnSample> samples,
                                       Long estimate, int sampled, boolean truncated, Integer headerRow) {
        List<String> header = rows.isEmpty() ? List.of() : rows.getFirst().cells();
        return new SheetMetadata(rows, name, "visible", null, estimate, columns, header, headerRow, samples, sampled,
                truncated, false, !truncated);
    }

    private static WorkbookMetadata workbook(SheetMetadata... sheets) {
        return new WorkbookMetadata(50, List.of(sheets), 1000, 64, 10, null);
    }

    @Test
    void hostileValuesCannotDefeatTheByteBudgetAndAreReportedNotFailed() {
        String nasty = "\"\\".repeat(48);
        List<String> cells = new ArrayList<>();
        for (int index = 0; index < 100; index++) cells.add(nasty);
        List<PreviewRow> rows = new ArrayList<>();
        for (int number = 1; number <= 11; number++) rows.add(new PreviewRow(number, cells));
        var hostile = new SheetMetadata(rows, "Hostile", "visible", null, 11L, 100, cells, 1,
                List.of(new ColumnSample(1, List.of(nasty), List.of("text"))), 11, false, false, true);
        var wb = new WorkbookMetadata(50, List.of(hostile), 1000, 100, 10, null);

        var preview = DatasetPreviewBuilder.build(version(UUID.randomUUID(), "XLSX", "x.xlsx"), wb, json);

        assertTrue(json.writeValueAsBytes(preview).length <= DatasetPreviewBuilder.MAX_RESPONSE_BYTES);
        assertTrue(preview.warnings().stream().anyMatch(warning -> warning.code().equals("RESPONSE_SIZE_CAPPED")));
        assertTrue(preview.truncated());
        assertTrue(preview.sheets().getFirst().sampleRows().size() < 3);
    }

    @Test
    void controlCharactersBecomeSpacesAndValuesAreCutOnACodePointBoundary() {
        var s = sheet("S", 2, List.of(row(1, "a", "b"), row(2, "x\u0000y\tz\n", "📊".repeat(100))),
                List.of(), 2L, 2, false, 1);
        var preview = DatasetPreviewBuilder.build(version(UUID.randomUUID(), "XLSX", "f\u0007.xlsx"), workbook(s), json);

        var cells = preview.sheets().getFirst().sampleRows().getFirst().cells();
        assertEquals("x y z ", cells.get(0));
        assertEquals(96, cells.get(1).getBytes(java.nio.charset.StandardCharsets.UTF_8).length);
        assertEquals(24, cells.get(1).codePointCount(0, cells.get(1).length()));
        assertEquals("f .xlsx", preview.originalFilename());
        assertTrue(preview.warnings().stream().anyMatch(warning -> warning.code().equals("VALUES_SHORTENED")));
    }

    @Test
    void anUnrepresentableBudgetIsAnErrorRatherThanAnOversizedResponse() {
        // 10 sheets of 10 maximum-length column names alone cannot be shrunk by dropping sample rows.
        List<String> names = new ArrayList<>();
        for (int index = 0; index < 10; index++) names.add("\"".repeat(96) + index);
        List<SheetMetadata> sheets = new ArrayList<>();
        for (int number = 0; number < 10; number++) {
            sheets.add(new SheetMetadata(List.of(), "\"".repeat(95) + number, "visible", "\"".repeat(60), 1L, 10, names,
                    1, List.of(), 1, false, false, true));
        }
        var wb = new WorkbookMetadata(50, sheets, 1000, 64, 10, null);
        // Names are cut at 96 bytes, so this fits comfortably: the guard only fires for an impossible response.
        var preview = DatasetPreviewBuilder.build(version(UUID.randomUUID(), "XLSX", "x.xlsx"), wb, json);
        assertTrue(json.writeValueAsBytes(preview).length <= DatasetPreviewBuilder.MAX_RESPONSE_BYTES);
        assertThrows(IllegalStateException.class, () -> DatasetPreviewBuilder.build(
                version(UUID.randomUUID(), "XLSX", "x.xlsx"), wb, new ObjectMapper() {
                    @Override
                    public byte[] writeValueAsBytes(Object value) {
                        return new byte[DatasetPreviewBuilder.MAX_RESPONSE_BYTES + 1];
                    }
                }));
    }

    @Test
    void typeInferenceSeparatesTheHeaderTextFromTheData() {
        assertEquals("NUMBER", DatasetPreviewBuilder.infer(new ColumnSample(1, List.of("n", "1", "2.5", "-3e2"),
                List.of("number", "text")), true, 3));
        assertEquals("MIXED", DatasetPreviewBuilder.infer(new ColumnSample(1, List.of("n", "1", "oops"),
                List.of("number", "text")), true, 2));
        assertEquals("BOOLEAN", DatasetPreviewBuilder.infer(new ColumnSample(1, List.of("b", "true", "false"),
                List.of("boolean", "text")), true, 2));
        assertEquals("DATE", DatasetPreviewBuilder.infer(new ColumnSample(1,
                List.of("d", "2026-09-29", "2026-09-29T10:20:30", "10:20"), List.of("date", "text")), true, 3));
        assertEquals("MIXED", DatasetPreviewBuilder.infer(new ColumnSample(1, List.of("d", "tomorrow"),
                List.of("date", "text")), true, 1));
        assertEquals("FORMULA", DatasetPreviewBuilder.infer(new ColumnSample(1, List.of("f", "=A1"),
                List.of("formula", "text")), true, 1));
        assertEquals("ERROR", DatasetPreviewBuilder.infer(new ColumnSample(1, List.of("e", "#DIV/0!"),
                List.of("error", "text")), true, 1));
        assertEquals("TEXT", DatasetPreviewBuilder.infer(new ColumnSample(1, List.of("h", "a"), List.of("text")), true, 1));
        assertEquals("UNKNOWN", DatasetPreviewBuilder.infer(new ColumnSample(1, List.of("h", "a"), List.of("text")), true, 0));
        assertEquals("UNKNOWN", DatasetPreviewBuilder.infer(null, true, 5));
        assertEquals("UNKNOWN", DatasetPreviewBuilder.infer(new ColumnSample(1, List.of(), List.of("empty")), false, 5));
        assertEquals("UNKNOWN", DatasetPreviewBuilder.infer(new ColumnSample(1, List.of("h"), List.of("text")), true, 5));
        assertEquals("MIXED", DatasetPreviewBuilder.infer(new ColumnSample(1, List.of("1"), List.of("number", "date")), false, 1));
        assertEquals("NUMBER", DatasetPreviewBuilder.infer(new ColumnSample(1, List.of("1", "2"), List.of("number")), false, 2));
        assertEquals("TEXT", DatasetPreviewBuilder.infer(new ColumnSample(1, List.of("x"), List.of("other")), false, 1));
    }

    @Test
    void anIncompleteScanReportsAnUnknownTotalAndKeepsTheSampleHonest() {
        var rows = new ArrayList<PreviewRow>();
        rows.add(row(1, "a", "b"));
        for (int number = 2; number <= 12; number++) rows.add(row(number, String.valueOf(number), "x"));
        var s = sheet("Big", 2, rows, List.of(new ColumnSample(1, List.of("a", "2"), List.of("number", "text")),
                new ColumnSample(2, List.of("b", "x"), List.of("text"))), null, 12, true, 1);

        var preview = DatasetPreviewBuilder.build(version(UUID.randomUUID(), "XLSX", "big.xlsx"), workbook(s), json);

        var sheet = preview.sheets().getFirst();
        assertNull(sheet.dimensions().rowCount());
        assertNull(sheet.dimensions().dataRowCount());
        assertTrue(sheet.dimensions().rowCountEstimated());
        assertEquals(12, sheet.dimensions().scannedRows());
        assertEquals(10, sheet.sampleRows().size());
        assertEquals(2, sheet.sampleRows().getFirst().rowNumber(), "the header row is not a data row");
        assertFalse(sheet.columns().getFirst().missingValuesExact());
        var codes = preview.warnings().stream().map(DatasetPreview.Warning::code).toList();
        assertTrue(codes.containsAll(List.of("ROWS_TRUNCATED", "ROW_COUNT_ESTIMATED", "MISSING_VALUES_PARTIAL")));
        assertTrue(preview.truncated());
    }

    @Test
    void aCompleteSmallSheetHasExactCountsAndNoTruncationWarning() {
        var s = sheet("Small", 2, List.of(row(1, "k", "v"), row(2, "a", ""), row(3, "b", "2")),
                List.of(new ColumnSample(1, List.of("k", "a", "b"), List.of("text")),
                        new ColumnSample(2, List.of("v", "2"), List.of("number", "text"))), 3L, 3, false, 1);

        var preview = DatasetPreviewBuilder.build(version(UUID.randomUUID(), "XLSX", "s.xlsx"), workbook(s), json);

        var sheet = preview.sheets().getFirst();
        assertEquals(3L, sheet.dimensions().rowCount());
        assertEquals(2L, sheet.dimensions().dataRowCount());
        assertFalse(sheet.dimensions().rowCountEstimated());
        assertEquals(1, sheet.columns().get(1).missingValues());
        assertTrue(sheet.columns().get(1).missingValuesExact());
        assertEquals(List.of("TEXT", "NUMBER"), sheet.columns().stream().map(DatasetPreview.Column::inferredType).toList());
        assertFalse(preview.truncated());
        assertFalse(sheet.truncated());
        assertEquals("TYPES_INFERRED", preview.warnings().getFirst().code());
        assertEquals(List.of("a", ""), sheet.sampleRows().getFirst().cells());
    }

    @Test
    void sheetsAreListedEvenWhenTheirColumnsAreUnknownOrBeyondTheWorkerLimit() {
        var unknownColumns = new SheetMetadata(List.of(row(1, "a", "b", "c")), "Unknown", "hidden", null, 1L, null,
                List.of("a", "b", "c"), 1, List.of(), 1, false, null, false);
        var overLimit = new SheetMetadata(List.of(row(1, "a")), "Wide", "visible", "A1:ZZ9", 9L, 200, List.of("a"), 1,
                List.of(), 1, true, null, false);

        var preview = DatasetPreviewBuilder.build(version(UUID.randomUUID(), "XLSX", "u.xlsx"),
                workbook(unknownColumns, overLimit), json);

        assertEquals(2, preview.sheets().size());
        assertEquals("hidden", preview.sheets().getFirst().state());
        assertEquals(3, preview.sheets().getFirst().columns().size());
        assertNull(preview.sheets().getFirst().dimensions().columnCount());
        assertNull(preview.sheets().getFirst().formulaPresence());
        var wide = preview.sheets().get(1);
        assertEquals(50, wide.columns().size(), "two sheets share the 100-column budget equally");
        assertEquals("Column 2", wide.columns().get(1).name(), "names missing from the header are positional");
        assertTrue(preview.warnings().stream().anyMatch(w -> w.code().equals("COLUMNS_TRUNCATED")
                && "Wide".equals(w.sheet()) && w.message().equals("Showing the first 50 of 200 columns.")));
    }

    @Test
    void aSheetWithoutAHeaderHasNoDataRows() {
        var empty = sheet("Empty", 1, List.of(), List.of(), 0L, 0, false, null);
        var preview = DatasetPreviewBuilder.build(version(UUID.randomUUID(), "XLSX", "e.xlsx"), workbook(empty), json);

        var sheet = preview.sheets().getFirst();
        assertNull(sheet.headerRow());
        assertTrue(sheet.sampleRows().isEmpty());
        assertEquals("Column 1", sheet.columns().getFirst().name());
        assertEquals("UNKNOWN", sheet.columns().getFirst().inferredType());
        assertEquals(0L, sheet.dimensions().dataRowCount());
    }

    @Test
    void formulasAreOnlyEverTextAndAreFlagged() {
        var s = new SheetMetadata(List.of(row(1, "calc"), row(2, "=1+1")), "F", "visible", null, 2L, 1, List.of("calc"),
                1, List.of(new ColumnSample(1, List.of("calc", "=1+1"), List.of("formula", "text"))), 2, false, true,
                true);
        var preview = DatasetPreviewBuilder.build(version(UUID.randomUUID(), "XLSX", "f.xlsx"), workbook(s), json);

        assertFalse(preview.formulasEvaluated());
        assertEquals("=1+1", preview.sheets().getFirst().sampleRows().getFirst().cells().getFirst());
        assertEquals("FORMULA", preview.sheets().getFirst().columns().getFirst().inferredType());
        assertTrue(preview.warnings().stream().anyMatch(w -> w.code().equals("FORMULAS_NOT_EVALUATED")));
    }

    @Test
    void moreThanTenSheetsAreOmittedWithAWarning() {
        var sheets = new ArrayList<SheetMetadata>();
        for (int number = 1; number <= 12; number++) {
            sheets.add(sheet("S" + number, 1, List.of(row(1, "h"), row(2, "v")),
                    List.of(new ColumnSample(1, List.of("h", "v"), List.of("text"))), 2L, 2, false, 1));
        }
        var preview = DatasetPreviewBuilder.build(version(UUID.randomUUID(), "XLSX", "m.xlsx"),
                new WorkbookMetadata(50, sheets, 1000, 64, 10, null), json);

        assertEquals(10, preview.sheets().size());
        assertEquals("SHEETS_OMITTED", preview.warnings().getFirst().code());
        assertEquals("The workbook has 12 sheets; only the first 10 are listed.", preview.warnings().getFirst().message());
        assertTrue(preview.sheets().stream().allMatch(s -> s.columns().size() <= 10 && s.sampleRows().size() <= 3));
    }
}
