"""RH-131 dataset preview: bounded, inert structure for the browser and an analysis planner.

The Spring ``DatasetPreviewBuilder`` implements the same algorithm; both are checked against
``contracts/analysis/dataset-preview/v1``. Set ``UPDATE_CONTRACT_FIXTURES=1`` to regenerate the committed fixtures
after an intentional change, then review the diff.
"""
import json
import os
from io import BytesIO
from pathlib import Path
from uuid import UUID, uuid4

import pytest
from openpyxl import Workbook
from pydantic import ValidationError

from researchhub_worker.contracts import (ColumnSample, PreviewRow as WorkerRow, SheetMetadata, SourceIngestResult,
                                          WorkbookMetadata)
from researchhub_worker.data import DatasetPreview, build_dataset_preview
from researchhub_worker.data.contracts import (MAX_CELL_BYTES, MAX_CELLS, MAX_COLUMNS, MAX_RESPONSE_BYTES,
                                               MAX_SAMPLE_ROWS, MAX_SHEETS, PreviewColumn, PreviewRow)
from researchhub_worker.data.preview import infer_type
from researchhub_worker.parsing.common import ParserLimits
from researchhub_worker.parsing.csv import parse_csv
from researchhub_worker.parsing.xlsx import parse_xlsx

ROOT = Path(__file__).resolve().parents[2] / 'contracts'
FIXTURES = ROOT / 'analysis' / 'dataset-preview' / 'v1'
VERSION = UUID('00000000-0000-4000-8000-0000000000a1')
SHA = 'ab' * 32


def _identity(kind, name='data'):
    return dict(source_version_id=VERSION, version_number=2, original_filename=name, size_bytes=2048,
                content_sha256=SHA, source_type=kind)


def _result(name):
    return SourceIngestResult.model_validate(json.loads((ROOT / 'processing' / 'v4' / name).read_text()))


def _dump(preview):
    return preview.model_dump(mode='json', by_alias=True)


def _check_fixture(name, produced):
    path = FIXTURES / name
    if os.getenv('UPDATE_CONTRACT_FIXTURES'):
        FIXTURES.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(produced, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    assert json.loads(path.read_text(encoding='utf-8')) == produced


def large_workbook():
    """Deterministic workbook metadata that exercises every cap: sheets, columns, rows, cells and values."""
    def sheet(name, columns, rows, header=('a', 'b', 'c'), **overrides):
        types = {1: ['text'], 2: ['number', 'text'], 3: ['text']}
        values = {
            'name': name, 'state': 'visible', 'used_range': None, 'row_count_estimate': rows, 'column_count': columns,
            'header_candidate': list(header), 'header_row': 1,
            'columns': [ColumnSample(column_number=index, values=[header[index - 1] if index <= len(header) else 'h',
                                                                  '1', '2'], data_types=types.get(index, ['text']))
                        for index in range(1, min(columns, 3) + 1)],
            'sampled_rows': min(rows, 12) if rows is not None else 12, 'truncated': False, 'formula_presence': False,
            'formula_scan_complete': True,
            'preview_rows': [WorkerRow(row_number=number, cells=[
                f'r{number}c{column}' for column in range(1, min(columns, 64) + 1)])
                for number in range(1, min(rows or 12, 12) + 1)],
        }
        values.update(overrides)
        return SheetMetadata(**values)

    wide = sheet('Wide', 120, 5000, header=tuple(f'h{index}' for index in range(1, 65)), used_range='A1:DP5000',
                 truncated=True, formula_scan_complete=False, formula_presence=None, sampled_rows=12)
    messy = sheet('Messy', 3, 4)
    messy = messy.model_copy(update={'preview_rows': [
        WorkerRow(row_number=1, cells=['a', 'b', 'c']),
        WorkerRow(row_number=2, cells=['\U0001f4ca' * 200, 'tab\there\nnewline', '=SUM(A1:A9)']),
        WorkerRow(row_number=3, cells=['x', '', ''])], 'sampled_rows': 3, 'row_count_estimate': 3})
    unknown = sheet('Unknown', 3, None, truncated=True, formula_presence=None, formula_scan_complete=False,
                    sampled_rows=12, row_count_estimate=None)
    sheets = [wide, messy, unknown] + [sheet(f'S{number}', 3, 4) for number in range(4, 13)]
    return WorkbookMetadata(preview_row_limit=50, sheets=sheets, row_limit=1000, column_limit=64, sample_limit=10)


def test_csv_fixture_matches_the_shared_contract_and_the_java_builder():
    result = _result('source-ingest-result-csv.json')
    preview = build_dataset_preview(result.workbook, source_id=result.source_id, **_identity('CSV', 'people.csv'))
    produced = _dump(preview)
    _check_fixture('csv-preview.json', produced)
    assert DatasetPreview.model_validate(produced) == preview
    sheet = preview.sheets[0]
    assert [column.inferred_type for column in sheet.columns] == ['TEXT', 'INTEGER', 'BOOLEAN', 'UNKNOWN']
    assert [row.row_number for row in sheet.sample_rows] == [2, 3], 'the header row is not a data row'
    assert sheet.dimensions.data_row_count == 2 and sheet.dimensions.row_count == 3
    assert sheet.dimensions.row_count_estimated is False
    assert preview.truncated is False and preview.formulas_evaluated is False


def test_workbook_fixture_matches_the_shared_contract_and_the_java_builder():
    result = _result('source-ingest-result-workbook.json')
    preview = build_dataset_preview(result.workbook, source_id=result.source_id,
                                    **_identity('XLSX', 'measurements.xlsx'))
    produced = _dump(preview)
    _check_fixture('xlsx-preview.json', produced)
    assert DatasetPreview.model_validate(produced) == preview
    measurements, hidden, internal, empty = preview.sheets
    assert [column.inferred_type for column in measurements.columns] == ['TEXT', 'NUMBER', 'FORMULA', 'BOOLEAN', 'DATE']
    assert measurements.sample_rows[0].cells[2] == '=B2*2', 'a formula is shown as text and never calculated'
    assert [sheet.state for sheet in preview.sheets] == ['visible', 'hidden', 'veryHidden', 'visible']
    assert hidden.dimensions.data_row_count == 0 and hidden.sample_rows == []
    assert all(column.inferred_type == 'UNKNOWN' for column in hidden.columns + internal.columns + empty.columns)
    assert internal.columns[0].name == 'Column 1', 'an empty header cell gets a positional name'
    assert empty.header_row is None and empty.dimensions.row_count == 0
    assert {warning.code for warning in preview.warnings} == {'FORMULAS_NOT_EVALUATED', 'TYPES_INFERRED'}


def test_large_workbook_is_capped_and_every_cut_is_named():
    workbook = large_workbook()
    _check_fixture('large-workbook.json', json.loads(workbook.model_dump_json(by_alias=True)))
    stored = WorkbookMetadata.model_validate(json.loads((FIXTURES / 'large-workbook.json').read_text()))
    assert stored == workbook
    preview = build_dataset_preview(stored, source_id=UUID('018f1f7a-13a5-7d54-a210-57f87bbcf682'),
                                    **_identity('XLSX', 'large.xlsx'))
    produced = _dump(preview)
    _check_fixture('large-preview.json', produced)
    assert DatasetPreview.model_validate(produced) == preview

    assert len(preview.sheets) == MAX_SHEETS and preview.truncated is True
    codes = {warning.code for warning in preview.warnings}
    assert {'SHEETS_OMITTED', 'ROWS_TRUNCATED', 'COLUMNS_TRUNCATED', 'ROW_COUNT_ESTIMATED',
            'VALUES_SHORTENED', 'TYPES_INFERRED'} <= codes
    assert sum(len(sheet.columns) for sheet in preview.sheets) <= MAX_COLUMNS
    assert sum(len(sheet.columns) * len(sheet.sample_rows) for sheet in preview.sheets) <= MAX_CELLS
    wide = preview.sheets[0]
    assert len(wide.columns) == 10 and len(wide.sample_rows) == 3 and wide.dimensions.data_row_count == 4999
    messy = preview.sheets[1]
    assert len(messy.sample_rows[0].cells[0].encode()) <= MAX_CELL_BYTES
    assert messy.sample_rows[0].cells[1] == 'tab here newline', 'control characters never reach the client'
    assert messy.sample_rows[0].cells[2] == '=SUM(A1:A9)'
    unknown = preview.sheets[2]
    assert unknown.dimensions.row_count is None and unknown.dimensions.data_row_count is None
    assert any(w.code == 'ROW_COUNT_ESTIMATED' and 'at least 12 rows' in w.message for w in preview.warnings)
    assert len(preview.model_dump_json(by_alias=True).encode()) < MAX_RESPONSE_BYTES


def test_published_json_schema_is_the_models_schema():
    _check_fixture('dataset-preview.schema.json', DatasetPreview.model_json_schema(by_alias=True))


def test_real_csv_parse_excludes_header_and_keeps_formulas_literal():
    source = uuid4()
    _, _, _, workbook, _, _, _ = parse_csv(b'name,value\nAda,1\nBob,\nEve,=1+1\n', source, ParserLimits())
    preview = build_dataset_preview(workbook, source_id=source, **_identity('CSV'))
    sheet = preview.sheets[0]
    assert preview.source_version_id == VERSION and preview.original_filename == 'data'
    assert sheet.dimensions.data_row_count == 3
    assert sheet.columns[1].missing_values == 1 and sheet.columns[1].missing_values_exact is True
    assert [row.cells for row in sheet.sample_rows] == [['Ada', '1'], ['Bob', ''], ['Eve', '=1+1']]
    assert len(json.dumps(_dump(preview)).encode()) < MAX_RESPONSE_BYTES


def test_real_csv_with_a_bounded_scan_reports_an_unknown_total():
    source = uuid4()
    body = 'a,b\n' + ''.join(f'{index},x\n' for index in range(30))
    _, _, _, workbook, _, _, _ = parse_csv(body.encode(), source, ParserLimits(xlsx_rows=10))
    preview = build_dataset_preview(workbook, source_id=source, **_identity('CSV'))
    sheet = preview.sheets[0]
    assert sheet.dimensions.row_count is None and sheet.dimensions.row_count_estimated is True
    assert sheet.dimensions.scanned_rows == 10 and len(sheet.sample_rows) == MAX_SAMPLE_ROWS - 1
    codes = {warning.code for warning in preview.warnings}
    assert {'ROWS_TRUNCATED', 'ROW_COUNT_ESTIMATED', 'MISSING_VALUES_PARTIAL'} <= codes
    assert preview.truncated is True


def _xlsx(rows):
    book = Workbook()
    sheet = book.active
    sheet.title = 'Data'
    for row in rows:
        sheet.append(row)
    stream = BytesIO()
    book.save(stream)
    return stream.getvalue()


def test_real_xlsx_infers_data_types_around_the_header_and_never_evaluates():
    source = uuid4()
    data = _xlsx([['name', 'amount', 'calc', 'mixed'], ['\U0001f4ca' * 200, 3, '=1+1', 'x'],
                  ['b', 4.5, '=2+2', 7]])
    _, _, _, workbook, _, _, _ = parse_xlsx(data, source, ParserLimits())
    preview = build_dataset_preview(workbook, source_id=source, **_identity('XLSX'))
    sheet = preview.sheets[0]
    assert [column.inferred_type for column in sheet.columns] == ['TEXT', 'NUMBER', 'FORMULA', 'MIXED']
    assert len(sheet.sample_rows[0].cells[0].encode()) <= MAX_CELL_BYTES
    assert sheet.sample_rows[0].cells[2] == '=1+1' and sheet.formula_presence is True
    assert sheet.dimensions.row_count == 3 and sheet.dimensions.row_count_estimated is False
    assert 'VALUES_SHORTENED' in {warning.code for warning in preview.warnings}
    assert 'FORMULAS_NOT_EVALUATED' in {warning.code for warning in preview.warnings}


@pytest.mark.parametrize('kind,values,header,rows,expected', [
    ('number', ['n', '1', '2.5', '-3e2'], True, 3, 'NUMBER'),
    ('number', ['n', '1', 'oops'], True, 2, 'MIXED'),
    ('boolean', ['b', 'true', 'false'], True, 2, 'BOOLEAN'),
    ('date', ['d', '2026-09-29', '2026-09-29T10:20:30', '10:20'], True, 3, 'DATE'),
    ('date', ['d', 'tomorrow'], True, 1, 'MIXED'),
    ('formula', ['f', '=A1', '=B2'], True, 2, 'FORMULA'),
    ('error', ['e', '#DIV/0!'], True, 1, 'ERROR'),
])
def test_type_inference_separates_the_header_text_from_the_data(kind, values, header, rows, expected):
    sample = ColumnSample(column_number=1, values=values, data_types=sorted({kind, 'text'}))
    assert infer_type(sample, header, rows) == expected


def test_type_inference_edge_cases():
    only_text = ColumnSample(column_number=1, values=['h', 'a'], data_types=['text'])
    assert infer_type(only_text, True, 1) == 'TEXT'
    assert infer_type(only_text, True, 0) == 'UNKNOWN', 'a header with no data rows describes no data'
    assert infer_type(None, True, 5) == 'UNKNOWN'
    assert infer_type(ColumnSample(column_number=1, values=[], data_types=['empty']), False, 5) == 'UNKNOWN'
    assert infer_type(ColumnSample(column_number=1, values=['h'], data_types=['text']), True, 5) == 'UNKNOWN'
    assert infer_type(ColumnSample(column_number=1, values=['1'], data_types=['number', 'date']), False, 1) == 'MIXED'
    assert infer_type(ColumnSample(column_number=1, values=['1', '2'], data_types=['number']), False, 2) == 'NUMBER'
    assert infer_type(ColumnSample(column_number=1, values=['x'], data_types=['other']), False, 1) == 'TEXT'


def test_response_budget_degrades_by_dropping_rows_instead_of_failing():
    nasty = '"\\' * 48  # every character doubles when JSON-escaped
    columns = 100
    rows = [WorkerRow(row_number=number, cells=[nasty] * columns) for number in range(1, 12)]
    header = WorkerRow(row_number=1, cells=[nasty] * columns)
    sheet = SheetMetadata(
        preview_rows=[header] + rows[1:], name='Hostile', state='visible', used_range=None, row_count_estimate=11,
        column_count=columns, header_candidate=[nasty] * columns, header_row=1,
        columns=[ColumnSample(column_number=1, values=[nasty], data_types=['text'])], sampled_rows=11,
        truncated=False, formula_presence=False, formula_scan_complete=True)
    workbook = WorkbookMetadata(preview_row_limit=50, sheets=[sheet], row_limit=1000, column_limit=100,
                                sample_limit=10)
    preview = build_dataset_preview(workbook, source_id=uuid4(), **_identity('XLSX'))
    assert len(preview.model_dump_json(by_alias=True).encode()) <= MAX_RESPONSE_BYTES
    assert 'RESPONSE_SIZE_CAPPED' in {warning.code for warning in preview.warnings}
    assert preview.truncated is True and len(preview.sheets[0].sample_rows) < 3


def test_a_budget_that_cannot_be_met_is_an_error_not_a_silent_overflow(monkeypatch):
    from researchhub_worker.data import preview as module
    monkeypatch.setattr(module, 'MAX_RESPONSE_BYTES', 100)
    result = _result('source-ingest-result-csv.json')
    with pytest.raises(ValueError, match='response budget'):
        build_dataset_preview(result.workbook, source_id=result.source_id, **_identity('CSV'))


def test_non_tabular_sources_are_refused():
    _, _, _, workbook, _, _, _ = parse_csv(b'a\n1\n', uuid4(), ParserLimits())
    with pytest.raises(ValueError):
        build_dataset_preview(workbook, source_id=uuid4(), **_identity('PDF'))


def test_the_contract_rejects_unsafe_or_oversized_content():
    produced = _dump(build_dataset_preview(_result('source-ingest-result-csv.json').workbook, source_id=uuid4(),
                                           **_identity('CSV')))
    for mutate in (lambda d: d.update(formulasEvaluated=True), lambda d: d.update(extra=1),
                   lambda d: d['sheets'][0]['sampleRows'][0]['cells'].__setitem__(0, 'x' * 97),
                   lambda d: d['sheets'][0]['sampleRows'][0]['cells'].__setitem__(0, 'bad\x00'),
                   lambda d: d['sheets'][0]['sampleRows'][0]['cells'].__setitem__(0, '\U0001f4ca' * 30),
                   lambda d: d.update(contentSha256='nothex'), lambda d: d.update(format='PDF'),
                   lambda d: d['sheets'][0]['columns'][0].update(inferredType='GUESS')):
        broken = json.loads(json.dumps(produced))
        mutate(broken)
        with pytest.raises(ValidationError):
            DatasetPreview.model_validate(broken)
    assert PreviewColumn(index=1, name='x', inferred_type='TEXT', missing_values=0, profiled_values=0,
                         missing_values_exact=True)
    assert PreviewRow(row_number=1, cells=['a'])
