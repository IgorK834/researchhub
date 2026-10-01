"""Build planner/browser metadata from already-bounded parser output. Formulas are text and never evaluated.

This is the reference implementation of the algorithm the Spring ``DatasetPreviewBuilder`` applies to the persisted
worker profile. Both are verified against ``contracts/analysis/dataset-preview/v1`` so they cannot drift apart.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field
from uuid import UUID

from ..contracts import ColumnSample, SheetMetadata, WorkbookMetadata
from .contracts import (MAX_CELLS, MAX_CELL_BYTES, MAX_COLUMNS, MAX_RESPONSE_BYTES, MAX_SAMPLE_ROWS, MAX_SHEETS,
                        TRUNCATION_CODES, DatasetPreview, Dimensions, PreviewColumn, PreviewRow, PreviewSheet,
                        PreviewWarning)

_NUMBER = re.compile(r'[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?')
_TEMPORAL = re.compile(r'[0-9]{4}-[0-9]{2}-[0-9]{2}'
                       r'(?:T[0-9]{2}:[0-9]{2}(?::[0-9]{2}(?:\.[0-9]+)?)?(?:Z|[+-][0-9]{2}:[0-9]{2})?)?'
                       r'|[0-9]{2}:[0-9]{2}(?::[0-9]{2}(?:\.[0-9]+)?)?')
_TYPES = {'boolean': 'BOOLEAN', 'date': 'DATE', 'number': 'NUMBER', 'formula': 'FORMULA', 'error': 'ERROR'}


@dataclass
class _Tracker:
    shortened: bool = False


@dataclass
class _Draft:
    name: str
    state: str
    header_row: int | None
    formula_presence: bool | None
    dimensions: Dimensions
    columns: list[PreviewColumn]
    rows: list[PreviewRow] = field(default_factory=list)
    rows_truncated: bool = False
    columns_truncated: bool = False
    known_columns: int = 0
    cells_capped: bool = False


def _safe(value: str | None, tracker: _Tracker) -> str:
    """Control characters become a space; the text is cut at 96 UTF-8 bytes on a character boundary."""
    if value is None:
        return ''
    out, used = [], 0
    for character in value:
        if unicodedata.category(character) == 'Cc':
            character = ' '
        size = len(character.encode('utf-8', errors='replace'))
        if used + size > MAX_CELL_BYTES:
            tracker.shortened = True
            break
        out.append(character)
        used += size
    return ''.join(out)


def _consistent(kind: str, value: str) -> bool:
    if kind == 'number':
        return _NUMBER.fullmatch(value) is not None
    if kind == 'boolean':
        return value in ('true', 'false')
    if kind == 'date':
        return _TEMPORAL.fullmatch(value) is not None
    if kind == 'formula':
        return value.startswith('=')
    if kind == 'error':
        return value.startswith('#')
    return True


def infer_type(sample: ColumnSample | None, header_present: bool, scanned_data_rows: int) -> str:
    """Worker ``dataTypes`` include the (usually text) header cell; consult the sampled values to separate them."""
    if sample is None or scanned_data_rows <= 0:
        return 'UNKNOWN'
    kinds = set(sample.data_types) - {'empty'}
    if not kinds:
        return 'UNKNOWN'
    values = sample.values[1:] if header_present and sample.values else list(sample.values)
    if header_present and not values:
        return 'UNKNOWN'
    text = 'text' in kinds
    kinds.discard('text')
    if not kinds:
        return 'TEXT'
    if len(kinds) > 1:
        return 'MIXED'
    kind = next(iter(kinds))
    if text and not all(_consistent(kind, value) for value in values):
        return 'MIXED'
    return _TYPES.get(kind, 'TEXT')


def _column(sheet: SheetMetadata, workbook: WorkbookMetadata, position: int, header_row: int, all_previewed: bool,
            tracker: _Tracker) -> PreviewColumn:
    number = position + 1
    csv = workbook.csv_profile
    if csv is not None and position < len(csv.columns):
        profile = csv.columns[position]
        return PreviewColumn(index=number, name=_safe(profile.name, tracker),
                             inferred_type=profile.inferred_type.upper(), missing_values=profile.missing_count,
                             profiled_values=csv.profiled_row_count, missing_values_exact=csv.row_scan_complete)
    header = sheet.header_candidate[position] if position < len(sheet.header_candidate) else ''
    name = header if header.strip() else f'Column {number}'
    data_rows = [row for row in sheet.preview_rows if header_row > 0 and row.row_number > header_row]
    missing = sum(position >= len(row.cells) or not row.cells[position].strip() for row in data_rows)
    scanned_data = max(0, sheet.sampled_rows - header_row)
    sample = next((column for column in sheet.columns if column.column_number == number), None)
    return PreviewColumn(index=number, name=_safe(name, tracker),
                         inferred_type=infer_type(sample, bool(header.strip()), scanned_data),
                         missing_values=missing, profiled_values=len(data_rows), missing_values_exact=all_previewed)


def _draft(sheet: SheetMetadata, workbook: WorkbookMetadata, allowance_columns: int, allowance_cells: int,
           tracker: _Tracker) -> _Draft:
    csv = workbook.csv_profile
    header_row = sheet.header_row or 0
    known = sheet.column_count if sheet.column_count is not None else len(sheet.header_candidate)
    width = max(0, min(allowance_columns, workbook.column_limit, known))
    scan_complete = csv.row_scan_complete if csv is not None else not sheet.truncated

    data_rows: list[PreviewRow] = []
    available = 0
    if header_row > 0:
        candidates = [row for row in sheet.preview_rows if row.row_number > header_row]
        available = len(candidates)
        cap = 0 if width == 0 else min(MAX_SAMPLE_ROWS, allowance_cells // width)
        for row in candidates[:cap]:
            cells = [_safe(row.cells[index], tracker) if index < len(row.cells) else '' for index in range(width)]
            data_rows.append(PreviewRow(row_number=row.row_number, cells=cells))

    all_previewed = scan_complete and len(sheet.preview_rows) >= sheet.sampled_rows
    columns = [_column(sheet, workbook, position, header_row, all_previewed, tracker) for position in range(width)]

    if csv is not None:
        row_count, data_row_count, estimated = sheet.row_count_estimate, csv.row_count, not csv.row_scan_complete
    else:
        row_count = sheet.sampled_rows if scan_complete else sheet.row_count_estimate
        data_row_count = None if row_count is None else max(0, row_count - header_row)
        estimated = not scan_complete
    dimensions = Dimensions(used_range=None if sheet.used_range is None else _safe(sheet.used_range, tracker),
                            row_count=row_count, data_row_count=data_row_count, row_count_estimated=estimated,
                            scanned_rows=sheet.sampled_rows, column_count=sheet.column_count)
    rows_truncated = (len(data_rows) < data_row_count if data_row_count is not None
                      else sheet.truncated or len(data_rows) < available)
    return _Draft(name=_safe(sheet.name, tracker), state=sheet.state, header_row=sheet.header_row,
                  formula_presence=sheet.formula_presence, dimensions=dimensions, columns=columns, rows=data_rows,
                  rows_truncated=rows_truncated, columns_truncated=width < known, known_columns=known)


def _assemble(identity: dict, drafts: list[_Draft], sheets_omitted: bool, workbook_sheets: int, shortened: bool,
              size_capped: bool) -> DatasetPreview:
    warnings: list[PreviewWarning] = []
    if sheets_omitted:
        warnings.append(PreviewWarning(code='SHEETS_OMITTED', sheet=None,
                                       message=f'The workbook has {workbook_sheets} sheets; only the first '
                                               f'{MAX_SHEETS} are listed.'))
    sheets: list[PreviewSheet] = []
    any_formula = False
    for draft in drafts:
        shown, dimensions = len(draft.rows), draft.dimensions
        rows_truncated = draft.rows_truncated or draft.cells_capped
        if rows_truncated:
            message = (f'Showing the first {shown} data rows; the sheet has more.'
                       if dimensions.data_row_count is None
                       else f'Showing the first {shown} of {dimensions.data_row_count} data rows.')
            warnings.append(PreviewWarning(code='ROWS_TRUNCATED', sheet=draft.name, message=message))
        if draft.columns_truncated:
            warnings.append(PreviewWarning(code='COLUMNS_TRUNCATED', sheet=draft.name,
                                           message=f'Showing the first {len(draft.columns)} of '
                                                   f'{draft.known_columns} columns.'))
        if dimensions.row_count_estimated:
            message = (f'The total row count is unknown; at least {dimensions.scanned_rows} rows were scanned.'
                       if dimensions.row_count is None
                       else "The row count is an estimate from the file's declared dimensions.")
            warnings.append(PreviewWarning(code='ROW_COUNT_ESTIMATED', sheet=draft.name, message=message))
        if any(not column.missing_values_exact for column in draft.columns):
            profiled = max((column.profiled_values for column in draft.columns), default=0)
            warnings.append(PreviewWarning(code='MISSING_VALUES_PARTIAL', sheet=draft.name,
                                           message=f'Missing-value counts cover only the first {profiled} data rows.'))
        any_formula = any_formula or draft.formula_presence is True
        sheets.append(PreviewSheet(name=draft.name, state=draft.state, header_row=draft.header_row,
                                   formula_presence=draft.formula_presence, dimensions=dimensions,
                                   columns=list(draft.columns), sample_rows=list(draft.rows),
                                   truncated=rows_truncated or draft.columns_truncated))
    any_formula = any_formula or any(column.inferred_type == 'FORMULA' for sheet in sheets for column in sheet.columns)
    if shortened:
        warnings.append(PreviewWarning(code='VALUES_SHORTENED', sheet=None,
                                       message=f'Values longer than {MAX_CELL_BYTES} bytes were shortened.'))
    if any_formula:
        warnings.append(PreviewWarning(code='FORMULAS_NOT_EVALUATED', sheet=None,
                                       message='Formulas are shown as text and are never calculated.'))
    warnings.append(PreviewWarning(code='TYPES_INFERRED', sheet=None,
                                   message='Column types are inferred from a bounded sample and may be wrong.'))
    if size_capped:
        warnings.append(PreviewWarning(code='RESPONSE_SIZE_CAPPED', sheet=None,
                                       message=f'Sample rows were removed to keep the response within '
                                               f'{MAX_RESPONSE_BYTES} bytes.'))
    return DatasetPreview(truncated=any(warning.code in TRUNCATION_CODES for warning in warnings),
                          warnings=warnings, sheets=sheets, **identity)


def build_dataset_preview(workbook: WorkbookMetadata, *, source_id: UUID, source_version_id: UUID,
                          version_number: int, original_filename: str, size_bytes: int, content_sha256: str,
                          source_type: str) -> DatasetPreview:
    """Return a capped, inert view suitable for a browser or analysis planner."""
    if source_type not in {'CSV', 'XLSX'}:
        raise ValueError('dataset preview supports CSV and XLSX')
    tracker = _Tracker()
    listed = workbook.sheets[:MAX_SHEETS]
    allowance_columns = max(1, MAX_COLUMNS // max(1, len(listed)))
    allowance_cells = max(1, MAX_CELLS // max(1, len(listed)))
    drafts = [_draft(sheet, workbook, allowance_columns, allowance_cells, tracker) for sheet in listed]
    omitted = len(workbook.sheets) > len(listed)
    identity = dict(source_id=source_id, source_version_id=source_version_id, version_number=version_number,
                    original_filename=_safe(original_filename, _Tracker()), size_bytes=size_bytes,
                    content_sha256=content_sha256, format=source_type)

    def assemble(capped: bool) -> DatasetPreview:
        return _assemble(identity, drafts, omitted, len(workbook.sheets), tracker.shortened, capped)

    preview = assemble(False)
    while len(preview.model_dump_json(by_alias=True).encode('utf-8')) > MAX_RESPONSE_BYTES:
        candidates = [draft for draft in drafts if draft.rows]
        if not candidates:
            raise ValueError('Bounded dataset preview exceeded its response budget')
        largest = candidates[0]
        for draft in candidates:
            if len(draft.rows) >= len(largest.rows):
                largest = draft
        largest.rows.pop()
        largest.cells_capped = True
        preview = assemble(True)
    return preview
