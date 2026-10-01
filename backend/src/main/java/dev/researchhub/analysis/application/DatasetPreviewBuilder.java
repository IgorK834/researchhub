package dev.researchhub.analysis.application;

import dev.researchhub.analysis.application.DatasetPreview.Column;
import dev.researchhub.analysis.application.DatasetPreview.Dimensions;
import dev.researchhub.analysis.application.DatasetPreview.Limits;
import dev.researchhub.analysis.application.DatasetPreview.Row;
import dev.researchhub.analysis.application.DatasetPreview.Sheet;
import dev.researchhub.analysis.application.DatasetPreview.Warning;
import dev.researchhub.processing.application.SourceExtraction.CsvProfile;
import dev.researchhub.processing.application.SourceExtraction.ColumnSample;
import dev.researchhub.processing.application.SourceExtraction.SheetMetadata;
import dev.researchhub.processing.application.SourceExtraction.WorkbookMetadata;
import dev.researchhub.source.application.SourceVersionSummary;
import tools.jackson.databind.ObjectMapper;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Objects;
import java.util.regex.Pattern;

/**
 * Pure projection of already-validated worker output into the public {@link DatasetPreview}.
 *
 * <p>Nothing here reads a file or evaluates a formula: a formula is the literal text the worker extracted. The same
 * algorithm is implemented by {@code researchhub_worker.data.build_dataset_preview}; both are checked against the
 * shared fixtures in {@code contracts/analysis/dataset-preview/v1}, so a change to one has to change the other.
 */
public final class DatasetPreviewBuilder {
    public static final int MAX_RESPONSE_BYTES = 65_536;
    public static final int MAX_SHEETS = 10;
    public static final int MAX_COLUMNS = 100;
    public static final int MAX_SAMPLE_ROWS = 10;
    public static final int MAX_CELLS = 300;
    public static final int MAX_CELL_BYTES = 96;

    static final Limits LIMITS = new Limits(MAX_RESPONSE_BYTES, MAX_SHEETS, MAX_COLUMNS, MAX_SAMPLE_ROWS, MAX_CELLS,
            MAX_CELL_BYTES);

    private static final Pattern NUMBER = Pattern.compile("[+-]?(?:[0-9]+(?:\\.[0-9]*)?|\\.[0-9]+)(?:[eE][+-]?[0-9]+)?");
    // The worker writes dates with Python's isoformat(); a pattern is enough to tell them from free text.
    private static final Pattern TEMPORAL = Pattern.compile("[0-9]{4}-[0-9]{2}-[0-9]{2}"
            + "(?:T[0-9]{2}:[0-9]{2}(?::[0-9]{2}(?:\\.[0-9]+)?)?(?:Z|[+-][0-9]{2}:[0-9]{2})?)?"
            + "|[0-9]{2}:[0-9]{2}(?::[0-9]{2}(?:\\.[0-9]+)?)?");

    private DatasetPreviewBuilder() {
    }

    /** The mutable working copy of one sheet; rows can still be dropped to honour the response budget. */
    private static final class Draft {
        final String name;
        final String state;
        final Integer headerRow;
        final Boolean formulaPresence;
        final Dimensions dimensions;
        final List<Column> columns;
        final List<Row> rows;
        final boolean rowsTruncated;
        final boolean columnsTruncated;
        final int knownColumns;
        boolean cellsCapped;

        Draft(String name, String state, Integer headerRow, Boolean formulaPresence, Dimensions dimensions,
              List<Column> columns, List<Row> rows, boolean rowsTruncated, boolean columnsTruncated,
              int knownColumns) {
            this.name = name;
            this.state = state;
            this.headerRow = headerRow;
            this.formulaPresence = formulaPresence;
            this.dimensions = dimensions;
            this.columns = columns;
            this.rows = rows;
            this.rowsTruncated = rowsTruncated;
            this.columnsTruncated = columnsTruncated;
            this.knownColumns = knownColumns;
        }
    }

    /** Tracks whether any value had to be shortened, so the caller can say so. */
    private static final class Shortened {
        boolean any;
    }

    public static DatasetPreview build(SourceVersionSummary version, WorkbookMetadata workbook, ObjectMapper json) {
        Objects.requireNonNull(version);
        Objects.requireNonNull(workbook);
        Shortened shortened = new Shortened();
        List<SheetMetadata> all = workbook.sheets();
        List<SheetMetadata> listed = all.stream().limit(MAX_SHEETS).toList();
        int allowanceColumns = Math.max(1, MAX_COLUMNS / Math.max(1, listed.size()));
        int allowanceCells = Math.max(1, MAX_CELLS / Math.max(1, listed.size()));
        List<Draft> drafts = new ArrayList<>();
        for (SheetMetadata sheet : listed) {
            drafts.add(draft(sheet, workbook, allowanceColumns, allowanceCells, shortened));
        }
        boolean omitted = all.size() > listed.size();
        DatasetPreview preview = assemble(version, drafts, omitted, all.size(), shortened.any, false);
        while (json.writeValueAsBytes(preview).length > MAX_RESPONSE_BYTES) {
            Draft largest = drafts.stream().filter(draft -> !draft.rows.isEmpty())
                    .reduce((a, b) -> b.rows.size() >= a.rows.size() ? b : a).orElse(null);
            if (largest == null) {
                throw new IllegalStateException("Bounded dataset preview exceeded its response budget");
            }
            largest.rows.removeLast();
            largest.cellsCapped = true;
            preview = assemble(version, drafts, omitted, all.size(), shortened.any, true);
        }
        return preview;
    }

    private static Draft draft(SheetMetadata sheet, WorkbookMetadata workbook, int allowanceColumns,
                               int allowanceCells, Shortened shortened) {
        CsvProfile csv = workbook.csvProfile();
        int headerRow = sheet.headerRow() == null ? 0 : sheet.headerRow();
        int known = sheet.columnCount() == null ? sheet.headerCandidate().size() : sheet.columnCount();
        int width = Math.max(0, Math.min(allowanceColumns, Math.min(workbook.columnLimit(), known)));
        boolean csvSheet = csv != null;
        boolean scanComplete = csvSheet ? csv.rowScanComplete() : !sheet.truncated();

        List<Row> dataRows = new ArrayList<>();
        int available = 0;
        if (headerRow > 0) {
            for (var previewRow : sheet.previewRows()) {
                if (previewRow.rowNumber() <= headerRow) continue;
                available++;
            }
            int cap = width == 0 ? 0 : Math.min(MAX_SAMPLE_ROWS, allowanceCells / width);
            for (var previewRow : sheet.previewRows()) {
                if (previewRow.rowNumber() <= headerRow) continue;
                if (dataRows.size() >= cap) break;
                dataRows.add(new Row(previewRow.rowNumber(), cells(previewRow.cells(), width, shortened)));
            }
        }

        boolean allPreviewed = scanComplete && sheet.previewRows().size() >= sheet.sampledRows();
        List<Column> columns = new ArrayList<>();
        for (int position = 0; position < width; position++) {
            columns.add(column(sheet, csv, position, headerRow, allPreviewed, shortened));
        }

        Long rowCount;
        boolean estimated;
        Long dataRowCount;
        if (csvSheet) {
            rowCount = sheet.rowCountEstimate();
            dataRowCount = csv.rowCount();
            estimated = !csv.rowScanComplete();
        } else {
            rowCount = scanComplete ? Long.valueOf(sheet.sampledRows()) : sheet.rowCountEstimate();
            dataRowCount = rowCount == null ? null : Long.valueOf(Math.max(0L, rowCount - headerRow));
            estimated = !scanComplete;
        }
        Dimensions dimensions = new Dimensions(nullableSafe(sheet.usedRange(), shortened), rowCount, dataRowCount,
                estimated, sheet.sampledRows(), sheet.columnCount());

        boolean rowsTruncated = dataRowCount != null ? dataRows.size() < dataRowCount
                : sheet.truncated() || dataRows.size() < available;
        boolean columnsTruncated = width < known;
        return new Draft(safe(sheet.name(), shortened), sheet.state(), sheet.headerRow(), sheet.formulaPresence(),
                dimensions, List.copyOf(columns), dataRows, rowsTruncated, columnsTruncated, known);
    }

    private static List<String> cells(List<String> source, int width, Shortened shortened) {
        List<String> cells = new ArrayList<>(width);
        for (int index = 0; index < width; index++) {
            cells.add(index < source.size() ? safe(source.get(index), shortened) : "");
        }
        return cells;
    }

    private static Column column(SheetMetadata sheet, CsvProfile csv, int position, int headerRow, boolean allPreviewed,
                                 Shortened shortened) {
        int number = position + 1;
        if (csv != null && position < csv.columns().size()) {
            var profile = csv.columns().get(position);
            return new Column(number, safe(profile.name(), shortened), profile.inferredType().toUpperCase(Locale.ROOT),
                    profile.missingCount(), csv.profiledRowCount(), csv.rowScanComplete());
        }
        String header = position < sheet.headerCandidate().size() ? sheet.headerCandidate().get(position) : "";
        String name = header.isBlank() ? "Column " + number : header;
        var dataRows = sheet.previewRows().stream().filter(row -> headerRow > 0 && row.rowNumber() > headerRow).toList();
        int missing = (int) dataRows.stream()
                .filter(row -> position >= row.cells().size() || row.cells().get(position).isBlank()).count();
        int scannedData = Math.max(0, sheet.sampledRows() - headerRow);
        String type = infer(sheet.columns().stream().filter(value -> value.columnNumber() == number).findFirst()
                .orElse(null), !header.isBlank(), scannedData);
        return new Column(number, safe(name, shortened), type, missing, dataRows.size(), allPreviewed);
    }

    /**
     * Worker {@code dataTypes} include the header cell, which is usually text. A column that is otherwise uniformly
     * numeric, boolean, date or formula is therefore not "mixed": the sampled values (header first) are consulted to
     * see whether the extra text can only be the header. Only the bounded sample is inspected, which the contract
     * states.
     */
    static String infer(ColumnSample sample, boolean headerPresent, int scannedDataRows) {
        if (sample == null || scannedDataRows <= 0) return "UNKNOWN";
        var kinds = new HashSet<>(sample.dataTypes());
        kinds.remove("empty");
        if (kinds.isEmpty()) return "UNKNOWN";
        List<String> values = headerPresent && !sample.values().isEmpty()
                ? sample.values().subList(1, sample.values().size()) : sample.values();
        if (headerPresent && values.isEmpty()) return "UNKNOWN";
        boolean text = kinds.remove("text");
        if (kinds.isEmpty()) return "TEXT";
        if (kinds.size() > 1) return "MIXED";
        String kind = kinds.iterator().next();
        if (text && !values.stream().allMatch(value -> consistent(kind, value))) return "MIXED";
        return switch (kind) {
            case "boolean" -> "BOOLEAN";
            case "date" -> "DATE";
            case "number" -> "NUMBER";
            case "formula" -> "FORMULA";
            case "error" -> "ERROR";
            default -> "TEXT";
        };
    }

    private static boolean consistent(String kind, String value) {
        return switch (kind) {
            case "number" -> NUMBER.matcher(value).matches();
            case "boolean" -> "true".equals(value) || "false".equals(value);
            case "date" -> TEMPORAL.matcher(value).matches();
            case "formula" -> value.startsWith("=");
            case "error" -> value.startsWith("#");
            default -> true;
        };
    }

    private static DatasetPreview assemble(SourceVersionSummary version, List<Draft> drafts, boolean sheetsOmitted,
                                           int workbookSheets, boolean shortened, boolean sizeCapped) {
        List<Warning> warnings = new ArrayList<>();
        if (sheetsOmitted) {
            warnings.add(new Warning("SHEETS_OMITTED", null, "The workbook has " + workbookSheets
                    + " sheets; only the first " + MAX_SHEETS + " are listed."));
        }
        List<Sheet> sheets = new ArrayList<>();
        boolean anyFormula = false;
        for (Draft draft : drafts) {
            long shown = draft.rows.size();
            Dimensions dimensions = draft.dimensions;
            boolean rowsTruncated = draft.rowsTruncated || draft.cellsCapped;
            if (rowsTruncated) {
                warnings.add(new Warning("ROWS_TRUNCATED", draft.name, dimensions.dataRowCount() == null
                        ? "Showing the first " + shown + " data rows; the sheet has more."
                        : "Showing the first " + shown + " of " + dimensions.dataRowCount() + " data rows."));
            }
            if (draft.columnsTruncated) {
                warnings.add(new Warning("COLUMNS_TRUNCATED", draft.name, "Showing the first " + draft.columns.size()
                        + " of " + draft.knownColumns + " columns."));
            }
            if (dimensions.rowCountEstimated()) {
                warnings.add(new Warning("ROW_COUNT_ESTIMATED", draft.name, dimensions.rowCount() == null
                        ? "The total row count is unknown; at least " + dimensions.scannedRows() + " rows were scanned."
                        : "The row count is an estimate from the file's declared dimensions."));
            }
            if (draft.columns.stream().anyMatch(column -> !column.missingValuesExact())) {
                int profiled = draft.columns.stream().mapToInt(Column::profiledValues).max().orElse(0);
                warnings.add(new Warning("MISSING_VALUES_PARTIAL", draft.name,
                        "Missing-value counts cover only the first " + profiled + " data rows."));
            }
            anyFormula |= Boolean.TRUE.equals(draft.formulaPresence);
            sheets.add(new Sheet(draft.name, draft.state, draft.headerRow, draft.formulaPresence, dimensions,
                    List.copyOf(draft.columns), List.copyOf(draft.rows), rowsTruncated || draft.columnsTruncated));
        }
        anyFormula |= sheets.stream().flatMap(sheet -> sheet.columns().stream())
                .anyMatch(column -> "FORMULA".equals(column.inferredType()));
        if (shortened) {
            warnings.add(new Warning("VALUES_SHORTENED", null,
                    "Values longer than " + MAX_CELL_BYTES + " bytes were shortened."));
        }
        if (anyFormula) {
            warnings.add(new Warning("FORMULAS_NOT_EVALUATED", null,
                    "Formulas are shown as text and are never calculated."));
        }
        warnings.add(new Warning("TYPES_INFERRED", null,
                "Column types are inferred from a bounded sample and may be wrong."));
        if (sizeCapped) {
            warnings.add(new Warning("RESPONSE_SIZE_CAPPED", null,
                    "Sample rows were removed to keep the response within " + MAX_RESPONSE_BYTES + " bytes."));
        }
        boolean truncated = warnings.stream().map(Warning::code).anyMatch(code -> List.of("SHEETS_OMITTED",
                "ROWS_TRUNCATED", "COLUMNS_TRUNCATED", "VALUES_SHORTENED", "RESPONSE_SIZE_CAPPED").contains(code));
        return new DatasetPreview(DatasetPreview.SCHEMA_VERSION, version.sourceId(), version.id(),
                version.versionNumber(), safe(version.originalFilename(), new Shortened()), version.sizeBytes(),
                version.contentSha256(), version.sourceType(), false, truncated, LIMITS, List.copyOf(warnings),
                List.copyOf(sheets));
    }

    private static String nullableSafe(String value, Shortened shortened) {
        return value == null ? null : safe(value, shortened);
    }

    /**
     * Replaces control characters with a space and cuts at {@link #MAX_CELL_BYTES} UTF-8 bytes on a code point
     * boundary. Control characters would otherwise expand six-fold when JSON-escaped and defeat the byte budget.
     */
    static String safe(String value, Shortened shortened) {
        if (value == null) return "";
        StringBuilder out = new StringBuilder(Math.min(value.length(), MAX_CELL_BYTES));
        int bytes = 0;
        for (int offset = 0; offset < value.length(); ) {
            int codePoint = value.codePointAt(offset);
            offset += Character.charCount(codePoint);
            if (Character.getType(codePoint) == Character.CONTROL) codePoint = ' ';
            int size = utf8Length(codePoint);
            if (bytes + size > MAX_CELL_BYTES) {
                shortened.any = true;
                break;
            }
            out.appendCodePoint(codePoint);
            bytes += size;
        }
        return out.toString();
    }

    private static int utf8Length(int codePoint) {
        if (codePoint < 0x80) return 1;
        if (codePoint < 0x800) return 2;
        if (codePoint < 0x10000) return 3;
        return 4;
    }
}
