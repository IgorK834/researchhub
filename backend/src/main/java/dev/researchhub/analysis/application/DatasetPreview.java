package dev.researchhub.analysis.application;

import java.util.List;
import java.util.UUID;

/**
 * Public RH-131 contract: a bounded, formula-inert description of one immutable CSV/XLSX source version.
 *
 * <p>Every value is an inert string. The server caps sheets, columns, sample rows, cells, cell bytes and the whole
 * serialized response ({@link Limits}); anything it had to leave out is named in {@link #warnings()} so a browser or
 * an analysis planner never mistakes the sample for the whole dataset. {@code sampleRows} contain data rows only: the
 * header row is described by {@link Sheet#columns()} and {@link Sheet#headerRow()}. The wire shape is mirrored by
 * {@code contracts/analysis/dataset-preview/v1} and by the Python model in {@code researchhub_worker.data}.
 */
public record DatasetPreview(
        String schemaVersion,
        UUID sourceId,
        UUID sourceVersionId,
        int versionNumber,
        String originalFilename,
        long sizeBytes,
        String contentSha256,
        String format,
        boolean formulasEvaluated,
        boolean truncated,
        Limits limits,
        List<Warning> warnings,
        List<Sheet> sheets) {

    public static final String SCHEMA_VERSION = "1.0";

    /** The caps this response was built under. */
    public record Limits(int maxResponseBytes, int maxSheets, int maxColumns, int maxSampleRows, int maxCells,
                         int maxCellBytes) {
    }

    /** A stable machine-readable {@code code}, the sheet it concerns (null when global), and a human message. */
    public record Warning(String code, String sheet, String message) {
    }

    /** {@code state} is visible, hidden or veryHidden; {@code formulaPresence} is null when the scan was partial. */
    public record Sheet(String name, String state, Integer headerRow, Boolean formulaPresence, Dimensions dimensions,
                        List<Column> columns, List<Row> sampleRows, boolean truncated) {
    }

    /**
     * {@code rowCount} counts rows including the header; {@code dataRowCount} excludes it. Both are null when the
     * scan stopped early and no estimate exists. When {@code rowCountEstimated} they are an estimate; {@code
     * scannedRows} is how many rows the bounded scan actually examined.
     */
    public record Dimensions(String usedRange, Long rowCount, Long dataRowCount, boolean rowCountEstimated,
                             int scannedRows, Integer columnCount) {
    }

    /** {@code index} is the 1-based column number in the sheet. Types: see the contract README. */
    public record Column(int index, String name, String inferredType, int missingValues, int profiledValues,
                         boolean missingValuesExact) {
    }

    /** {@code rowNumber} is the physical 1-based row in the sheet; {@code cells} always has one entry per column. */
    public record Row(int rowNumber, List<String> cells) {
    }
}
