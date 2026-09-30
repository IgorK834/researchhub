"""Bounded CSV schema and row preview; quoted separators/newlines remain structured cells."""
import csv
from io import StringIO
from itertools import islice

from ..contracts import ColumnSample, PreviewRow, SheetMetadata, UnitLocation, WorkbookMetadata
from .common import ParseFailure, TextBuilder

PARSER_VERSION = 'csv-stdlib/rh-1'


def parse_csv(data, source_id, limits):
    text = data.decode('utf-8-sig')
    if not text.strip():
        raise ParseFailure('EMPTY_DOCUMENT', 'The CSV contains no extractable text.')
    try:
        dialect = csv.Sniffer().sniff(text[:65536], delimiters=',;\t|')
    except csv.Error:
        dialect = csv.excel
    rows = list(islice(csv.reader(StringIO(text, newline=''), dialect=dialect, strict=True), limits.xlsx_rows + 1))
    extra_row = len(rows) > limits.xlsx_rows
    rows = rows[:limits.xlsx_rows]
    width = max((len(row) for row in rows), default=0)
    truncated = extra_row or width > limits.xlsx_columns
    header, header_row = [], None
    samples = [[] for _ in range(min(width, limits.xlsx_columns))]
    preview, lines = [], []
    for row_number, row in enumerate(rows, 1):
        cells = [cell.replace('\x00', '')[:500] for cell in row[:limits.xlsx_columns]]
        if row_number <= limits.preview_rows:
            preview.append(PreviewRow(row_number=row_number, cells=cells))
        if any(cells) and header_row is None:
            header, header_row = cells, row_number
        for index, value in enumerate(cells):
            if value and len(samples[index]) < limits.xlsx_samples:
                samples[index].append(value)
        lines.append(f'{row_number}: ' + '\t'.join(cells))
    sheet = SheetMetadata(name='CSV', state='visible', used_range=None,
        row_count_estimate=None if extra_row else len(rows), column_count=width,
        header_candidate=header, header_row=header_row,
        columns=[ColumnSample(column_number=index+1, values=values, data_types=['text'])
                 for index, values in enumerate(samples) if values],
        sampled_rows=len(rows), truncated=truncated, formula_presence=None if truncated else False,
        formula_scan_complete=not truncated, preview_rows=preview)
    builder = TextBuilder(source_id, PARSER_VERSION, limits)
    builder.add('\n'.join(lines), UnitLocation(kind='SHEET', sheet_name='CSV'))
    workbook = WorkbookMetadata(sheets=[sheet], row_limit=limits.xlsx_rows, column_limit=limits.xlsx_columns,
        sample_limit=limits.xlsx_samples, preview_row_limit=limits.preview_rows)
    warnings = ['TABLE_SAMPLED: Row/column limits apply to the CSV preview.'] if truncated else []
    return builder, [], [], workbook, warnings, None, None
