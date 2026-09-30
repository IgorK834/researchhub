package dev.researchhub.processing.application;

import java.util.HashSet;
import java.util.List;
import java.util.UUID;

/** Explicit parser output shared through application ports. Offsets count Unicode code points. */
public record SourceExtraction(String processingVersion, String parserVersion, ExtractionMetadata extractionMetadata,
                               DocumentStructure structure, List<ExtractedChunk> chunks,
                               WorkbookMetadata workbook, List<String> warnings) {
    public void validate(UUID sourceId) {
        require(identifier(processingVersion));
        require(parserVersion != null && !parserVersion.isBlank() && parserVersion.length() <= 128);
        require(extractionMetadata != null && structure != null && chunks != null && warnings != null);
        var metadata = extractionMetadata;
        require(metadata.pageCount() >= 0 && metadata.characterCount() >= 0 && metadata.characterCount() <= 500_000);
        require(metadata.contentSha256() != null && metadata.contentSha256().matches("[0-9a-f]{64}"));
        require(optionalText(metadata.title(), 500) && optionalText(metadata.author(), 500)
                && optionalText(metadata.language(), 32));
        require(structure.pages() != null && structure.sections() != null);
        require(structure.pages().size() <= 10_000 && structure.sections().size() <= 50_000
                && chunks.size() <= 10_000 && warnings.size() <= 100);
        require(metadata.pageCount() == structure.pages().size());
        long previous = 0;
        int pageNumber = 1;
        for (var page : structure.pages()) {
            require(page != null && page.pageNumber() == pageNumber++ && page.characterStart() == previous);
            range(page.characterStart(), page.characterEnd(), metadata.characterCount());
            previous = page.characterEnd();
        }
        if (!structure.pages().isEmpty()) require(previous == metadata.characterCount());
        var sections = new HashSet<String>();
        for (var section : structure.sections()) {
            require(section != null && identifier(section.sectionId()) && sections.add(section.sectionId()));
            require(section.level() >= 1 && section.level() <= 20 && optionalText(section.heading(), 500));
            require(section.parentSectionId() == null || (!section.sectionId().equals(section.parentSectionId())
                    && sections.contains(section.parentSectionId())));
            range(section.characterStart(), section.characterEnd(), metadata.characterCount());
        }
        previous = 0;
        var ids = new HashSet<String>();
        for (int ordinal = 0; ordinal < chunks.size(); ordinal++) {
            var chunk = chunks.get(ordinal);
            require(chunk != null && sourceId.equals(chunk.sourceId()) && parserVersion.equals(chunk.parserVersion()));
            require(identifier(chunk.chunkId()) && ids.add(chunk.chunkId()) && chunk.ordinal() == ordinal);
            require(chunk.text() != null && chunk.text().length() <= 500_000 && chunk.characterStart() == previous);
            range(chunk.characterStart(), chunk.characterEnd(), metadata.characterCount());
            require(chunk.characterEnd() - chunk.characterStart() == chunk.text().codePointCount(0, chunk.text().length()));
            require(chunk.sectionId() == null || sections.contains(chunk.sectionId()));
            if (chunk.pageNumber() != null) {
                require(chunk.pageNumber() >= 1 && chunk.pageNumber() <= structure.pages().size());
                var page = structure.pages().get(chunk.pageNumber() - 1);
                require(chunk.characterStart() >= page.characterStart() && chunk.characterEnd() <= page.characterEnd());
            }
            if (chunk.location() != null) chunk.location().validate();
            previous = chunk.characterEnd();
        }
        require(previous == metadata.characterCount());
        require(warnings.stream().allMatch(warning -> warning != null && !warning.isBlank() && warning.length() <= 500));
        if (workbook != null) workbook.validate();
    }

    private static boolean identifier(String text) { return text != null && !text.isBlank() && text.length() <= 128; }
    private static boolean optionalText(String text, int max) { return text == null || text.length() <= max; }
    private static void range(long start, long end, long max) { require(start >= 0 && end >= start && end <= max); }
    private static void require(boolean valid) {
        if (!valid) throw new IllegalArgumentException("Invalid source extraction contract");
    }

    public record ExtractionMetadata(String title, String author, String language, long pageCount,
                                     long characterCount, String contentSha256) {}
    public record DocumentStructure(List<PageStructure> pages, List<SectionStructure> sections) {}
    public record PageStructure(int pageNumber, long characterStart, long characterEnd) {}
    public record SectionStructure(String sectionId, String heading, int level, String parentSectionId,
                                   long characterStart, long characterEnd) {}
    public record ExtractedChunk(UUID sourceId, String parserVersion, UnitLocation location,
                                 String chunkId, int ordinal, String text, Integer pageNumber, String sectionId,
                                 long characterStart, long characterEnd) {}
    public record UnitLocation(String kind, Integer blockIndex, Integer headingLevel, String sheetName, String cellRange) {
        void validate() {
            require(kind != null && List.of("PDF_PAGE", "PARAGRAPH", "HEADING", "TABLE", "SHEET", "TEXT").contains(kind));
            require(blockIndex == null || blockIndex >= 0);
            require(headingLevel == null || (headingLevel >= 1 && headingLevel <= 20));
            require(optionalText(sheetName, 128) && optionalText(cellRange, 64));
        }
    }
    public record ColumnSample(int columnNumber, List<String> values, List<String> dataTypes) {
        void validate(int columnLimit, int sampleLimit) {
            require(columnNumber >= 1 && columnNumber <= columnLimit && values != null && dataTypes != null);
            require(values.size() <= sampleLimit && dataTypes.size() <= 10);
            require(values.stream().allMatch(value -> value != null && value.length() <= 500));
            require(dataTypes.stream().allMatch(type -> type != null && List.of("empty", "formula", "error", "boolean", "date", "number", "text").contains(type)));
        }
    }
    public record PreviewRow(int rowNumber, List<String> cells) {}
    public record SheetMetadata(List<PreviewRow> previewRows, String name, String state, String usedRange, Long rowCountEstimate,
                                Integer columnCount, List<String> headerCandidate, Integer headerRow,
                                List<ColumnSample> columns, int sampledRows, boolean truncated,
                                Boolean formulaPresence, boolean formulaScanComplete) {
        void validate(int rowLimit, int columnLimit, int sampleLimit, int previewRowLimit) {
            require(previewRows != null && previewRows.size() <= previewRowLimit);
            int previousRow = 0;
            for (var row : previewRows) {
                require(row != null && row.rowNumber() > previousRow && row.rowNumber() <= sampledRows
                        && row.cells() != null && row.cells().size() <= columnLimit);
                require(row.cells().stream().allMatch(value -> value != null && value.length() <= 500));
                previousRow = row.rowNumber();
            }
            require(identifier(name) && state != null && List.of("visible", "hidden", "veryHidden").contains(state));
            require(optionalText(usedRange, 64) && (rowCountEstimate == null || (rowCountEstimate >= 0 && rowCountEstimate <= 1048576)));
            require(columnCount == null || (columnCount >= 0 && columnCount <= 16384));
            require(headerRow == null || (headerRow >= 1 && headerRow <= rowLimit));
            require(headerCandidate != null && headerCandidate.size() <= columnLimit
                    && headerCandidate.stream().allMatch(value -> value != null && value.length() <= 500));
            require(columns != null && columns.size() <= columnLimit && sampledRows >= 0 && sampledRows <= rowLimit);
            var indexes = new HashSet<Integer>();
            for (var column : columns) {
                require(column != null && indexes.add(column.columnNumber()));
                column.validate(columnLimit, sampleLimit);
            }
            require(!formulaScanComplete || (!truncated && formulaPresence != null));
            require(formulaPresence == null || formulaPresence || formulaScanComplete);
        }
    }
    public record WorkbookMetadata(int previewRowLimit, List<SheetMetadata> sheets, int rowLimit, int columnLimit, int sampleLimit) {
        void validate() {
            require(previewRowLimit >= 1 && previewRowLimit <= 100);
            require(rowLimit >= 1 && rowLimit <= 10000 && columnLimit >= 1 && columnLimit <= 256 && sampleLimit >= 1 && sampleLimit <= 100);
            require(sheets != null && sheets.size() <= 100);
            var names = new HashSet<String>();
            for (var sheet : sheets) {
                require(sheet != null && names.add(sheet.name()));
                sheet.validate(rowLimit, columnLimit, sampleLimit, previewRowLimit);
            }
        }
    }
}
