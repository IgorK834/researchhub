"""Bounded CSV data-asset profiling; RAG receives schema metadata, never sampled row values."""
import csv
from datetime import date
from io import StringIO
from itertools import islice
import re

from ..contracts import ColumnSample, PreviewRow, SheetMetadata, UnitLocation, WorkbookMetadata
from ..tabular_contracts import CsvColumn, CsvProfile
from .common import ParseFailure, TextBuilder

PARSER_VERSION = 'csv-stdlib/rh-2'
DELIMITERS = ',;\t|'


def _reader(text, delimiter):
    return csv.reader(StringIO(text, newline=''), delimiter=delimiter or ',', strict=True)


def _delimiter(text):
    # Sniffer is advisory. Never silently accept ragged multi-column data as a single text column.
    try:
        return csv.Sniffer().sniff(text[:65536], delimiters=DELIMITERS).delimiter
    except csv.Error:
        candidates = []
        for delimiter in DELIMITERS:
            try:
                widths = [len(row) for row in islice(_reader(text, delimiter), 50) if row]
            except csv.Error:
                continue
            if widths and widths[0] > 1 and len(set(widths)) == 1:
                candidates.append(delimiter)
        if len(candidates) == 1:
            return candidates[0]
        if len(candidates) > 1:
            raise ParseFailure('CSV_DELIMITER_INVALID', 'The CSV delimiter is ambiguous. Use one consistent comma, semicolon, tab or pipe separator.')
        return None


def _primitive(value):
    value = value.strip()
    if len(value) > 500:
        return 'text'
    if value.lower() in ('true', 'false'):
        return 'boolean'
    # Preserve leading-zero identifiers as text. Locale-specific decimals are intentionally not guessed.
    if re.fullmatch(r'[+-]?(?:0|[1-9][0-9]*)', value):
        return 'integer'
    if re.fullmatch(r'[+-]?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?', value):
        return 'number'
    if re.fullmatch(r'[0-9]{4}-[0-9]{2}-[0-9]{2}', value):
        try:
            date.fromisoformat(value)
            return 'date'
        except ValueError:
            pass
    return 'text'


def _inferred(types):
    if not types:
        return 'unknown'
    if types <= {'integer', 'number'}:
        return 'number' if 'number' in types else 'integer'
    return next(iter(types)) if len(types) == 1 else 'text'


def _bounded(value, limit=500):
    # The existing Java sheet metadata limit counts UTF-16 units. Do not split a surrogate pair.
    return value.encode('utf-16-le')[:limit*2].decode('utf-16-le', errors='ignore')


def _names(header):
    names, used = [], set()
    for index, raw in enumerate(header, 1):
        base = _bounded(' '.join(raw.split())) or f'column_{index}'
        name, suffix = base, 1
        while name in used:
            suffix += 1
            ending = f'_{suffix}'
            name = _bounded(base, 500-len(ending)) + ending
        used.add(name)
        names.append(name)
    return names


def parse_csv(data, source_id, limits):
    try:
        text = data.decode('utf-8-sig')
    except UnicodeDecodeError:
        raise ParseFailure('CSV_ENCODING_INVALID', 'The CSV must use UTF-8 encoding; an optional UTF-8 BOM is supported.') from None
    if '\x00' in text:
        raise ParseFailure('CSV_ENCODING_INVALID', 'The CSV contains unsupported binary or encoding data.')
    if not text.strip():
        raise ParseFailure('EMPTY_DOCUMENT', 'The CSV contains no extractable text.')
    delimiter = _delimiter(text)
    try:
        records = list(islice(_reader(text, delimiter), limits.xlsx_rows + 1))
    except csv.Error:
        raise ParseFailure('CSV_MALFORMED', 'The CSV quoting or record structure is invalid.') from None
    extra_row = len(records) > limits.xlsx_rows
    rows = records[:limits.xlsx_rows]
    header_index = next((index for index, row in enumerate(rows) if any(cell.strip() for cell in row)), None)
    if header_index is None:
        if extra_row:
            raise ParseFailure('EXTRACTION_LIMIT_EXCEEDED', 'The CSV header is outside the configured row scan limit.')
        raise ParseFailure('EMPTY_DOCUMENT', 'The CSV contains no nonempty records.')
    header = rows[header_index]
    width = len(header)
    if width > 16384:
        raise ParseFailure('EXTRACTION_LIMIT_EXCEEDED', 'The CSV exceeds the supported column count.')
    if any(row and len(row) != width for row in records[header_index+1:]):
        raise ParseFailure('CSV_DELIMITER_INVALID', 'The CSV has inconsistent column counts. Use one consistent comma, semicolon, tab or pipe separator.')
    # A single-column file has no inferred separator. Separator-bearing ragged input must fail safely.
    if delimiter is None and width == 1:
        for separator in DELIMITERS[1:]:
            alternative = next(_reader(text, separator), [])
            if len(alternative) > 1:
                raise ParseFailure('CSV_DELIMITER_INVALID', 'The CSV delimiter or column counts are inconsistent.')
    bounded_header = [_bounded(value) for value in header[:limits.xlsx_columns]]
    names = _names(bounded_header)
    samples = [[] for _ in names]
    types = [set() for _ in names]
    missing = [0 for _ in names]
    data_rows = rows[header_index+1:]
    for row in data_rows:
        for index in range(len(names)):
            value = row[index] if row else ''
            if not value.strip():
                missing[index] += 1
            else:
                types[index].add(_primitive(value))
                if len(samples[index]) < limits.xlsx_samples:
                    samples[index].append(_bounded(value))
    profile = CsvProfile(encoding='UTF-8-BOM' if data.startswith(b'\xef\xbb\xbf') else 'UTF-8',
        delimiter=delimiter, row_count=None if extra_row else len(data_rows),
        profiled_row_count=len(data_rows), row_scan_complete=not extra_row,
        columns=[CsvColumn(column_number=index+1, name=name, inferred_type=_inferred(types[index]), missing_count=missing[index])
                 for index, name in enumerate(names)])
    truncated = extra_row or width > limits.xlsx_columns
    preview = [PreviewRow(row_number=index+1, cells=[_bounded(value) for value in row[:limits.xlsx_columns]])
               for index, row in enumerate(rows[:limits.preview_rows])]
    sheet = SheetMetadata(name='CSV', state='visible', used_range=None,
        row_count_estimate=None if extra_row else len(rows), column_count=width,
        header_candidate=bounded_header, header_row=header_index+1,
        columns=[ColumnSample(column_number=index+1, values=values, data_types=['text'] if values else ['empty'])
                 for index, values in enumerate(samples)],
        sampled_rows=len(rows), truncated=truncated, formula_presence=None if truncated else False,
        formula_scan_complete=not truncated, preview_rows=preview)
    builder = TextBuilder(source_id, PARSER_VERSION, limits)
    # This metadata is derived from the immutable file. Raw row values remain solely in bounded previews.
    separator_name = {',': 'comma', ';': 'semicolon', '\t': 'tab', '|': 'pipe', None: 'single column'}[delimiter]
    summary = [f'CSV data asset. Encoding: {profile.encoding}. Delimiter: {separator_name}.',
        f'Data rows: {profile.row_count if profile.row_count is not None else "unknown (bounded scan)"}. Profiled data rows: {profile.profiled_row_count}.',
        'First nonempty record is an assumed header. Types are inferred and may be wrong.',
        'Missing values mean empty or whitespace-only cells. Retrieval contains schema metadata only.']
    summary.extend(f'Column {column.column_number}: {column.name}; inferred type: {column.inferred_type}; missing in profiled rows: {column.missing_count}.'
                   for column in profile.columns)
    builder.add('\n'.join(summary), UnitLocation(kind='SHEET', sheet_name='CSV'))
    workbook = WorkbookMetadata(csv_profile=profile, sheets=[sheet], row_limit=limits.xlsx_rows, column_limit=limits.xlsx_columns,
        sample_limit=limits.xlsx_samples, preview_row_limit=limits.preview_rows)
    warnings = ['CSV_HEADER_ASSUMED: The first nonempty record is treated as a header; verify column names.',
                'TYPE_INFERENCE: Primitive types describe the bounded data sample and may be wrong.']
    if truncated:
        warnings.append('TABLE_SAMPLED: Row/column limits apply; missing counts and inferred types cover only profiled cells.')
    return builder, [], [], workbook, warnings, None, None
