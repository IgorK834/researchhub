"""RH-092 CSV asset contracts, bounded profiling and schema-only retrieval."""
import hashlib
import json
from pathlib import Path
from uuid import uuid4
import pytest
from pydantic import ValidationError
from researchhub_worker.contracts import SourceIngestCommand, SourceIngestResult, WorkbookMetadata
from researchhub_worker.tabular_contracts import CsvProfile
from researchhub_worker.parsing import SourceParser
from researchhub_worker.parsing.common import ParserLimits


def parse(data, limits=None):
    raw = json.loads((Path(__file__).resolve().parents[2] / 'contracts/processing/v4/source-ingest-request.json').read_text())
    command = SourceIngestCommand.model_validate(raw | {'sourceType': 'CSV', 'jobId': str(uuid4())})
    return SourceParser(limits, downloader=lambda _command, _limits: data)(command)


@pytest.mark.parametrize('delimiter', [',', ';', '\t', '|'])
def test_common_delimiters_inference_and_missing_summary(delimiter):
    data = '\n'.join(row.replace(',', delimiter) for row in [
        'name,age,weight,active,date,id,empty', 'Ada,37,1.5,true,2026-09-30,00123,',
        'Bob, ,2,false,2026-10-01,00456, ']).encode('utf-8-sig')
    result = parse(data)
    assert result.status == 'SUCCEEDED'
    profile = result.workbook.csv_profile
    assert profile.encoding == 'UTF-8-BOM' and profile.delimiter == delimiter
    assert profile.row_count == profile.profiled_row_count == 2 and profile.row_scan_complete
    assert [c.name for c in profile.columns] == ['name','age','weight','active','date','id','empty']
    assert [c.inferred_type for c in profile.columns] == ['text','integer','number','boolean','date','text','unknown']
    assert [c.missing_count for c in profile.columns] == [0,1,0,0,0,0,2]
    assert result.workbook.sheets[0].preview_rows[1].cells[5] == '00123'
    assert result.extraction_metadata.content_sha256 == hashlib.sha256(data).hexdigest()
    assert all(c.page_start is None and 'Ada' not in c.content and '00123' not in c.content for c in result.retrieval.chunks)


def test_quotes_multiline_formulas_and_samples_remain_strings():
    result = parse(b'name;note;formula\nAda;"line 1\nline 2;quoted";=SUM(A1:A2)\nBob;"escaped ""quote""";@cmd')
    assert result.status == 'SUCCEEDED'
    assert result.workbook.sheets[0].preview_rows[1].cells == ['Ada','line 1\nline 2;quoted','=SUM(A1:A2)']
    assert result.workbook.csv_profile.columns[2].inferred_type == 'text'
    assert result.workbook.sheets[0].columns[0].values == ['Ada','Bob']
    assert all('SUM(' not in c.content and '@cmd' not in c.content for c in result.retrieval.chunks)
    assert result.parser_version == 'csv-stdlib/rh-2' and result.chunks[0].location.sheet_name == 'CSV'


@pytest.mark.parametrize('data,code', [
    (b'name,value\nprivate,\xff','CSV_ENCODING_INVALID'),(b'\xff\xfea\x00','CSV_ENCODING_INVALID'),
    (b'a\x00,b\n1,2','CSV_ENCODING_INVALID'),(b'a,b\n"PRIVATE_SECRET','CSV_MALFORMED'),
    (b'a,b\n1,2,3','CSV_DELIMITER_INVALID'),(b'a;b\n1;2;3','CSV_DELIMITER_INVALID'),
    (b'a,b\n1;2','CSV_DELIMITER_INVALID'),(b' ; \n','EMPTY_DOCUMENT'),(b'   ','EMPTY_DOCUMENT'),
    (b'a\n'+b'x'*140000,'CSV_MALFORMED'),
])
def test_safe_terminal_errors_have_no_partial_output(data, code):
    result = parse(data)
    assert result.status == 'FAILED' and result.failure.code == code
    assert 'private' not in result.failure.message.lower() and 'SECRET' not in result.failure.message
    assert not result.chunks and result.retrieval is None and result.workbook is None


def test_large_file_limits_preview_and_excludes_all_raw_rows_from_rag():
    result = parse(b'name,value\n'+b'PRIVATE_ROW_MARKER,42\n'*5000,
        ParserLimits(xlsx_rows=10,preview_rows=3,xlsx_samples=2))
    assert result.status == 'SUCCEEDED'
    profile, sheet = result.workbook.csv_profile, result.workbook.sheets[0]
    assert profile.row_count is None and not profile.row_scan_complete and profile.profiled_row_count == 9
    assert sheet.row_count_estimate is None and sheet.truncated
    assert len(sheet.preview_rows) == 3 and len(sheet.columns[0].values) == 2
    assert all('PRIVATE_ROW_MARKER' not in unit.text for unit in result.chunks)
    assert all('PRIVATE_ROW_MARKER' not in c.content for c in result.retrieval.chunks)
    assert any('TABLE_SAMPLED' in warning for warning in result.warnings)


def test_column_limit_header_only_and_single_column_files():
    result = parse(b'a,b,c\n1,2,3\n',ParserLimits(xlsx_columns=2))
    assert result.status == 'SUCCEEDED' and result.workbook.sheets[0].truncated
    assert result.workbook.csv_profile.row_count == 1 and len(result.workbook.csv_profile.columns) == 2
    assert result.workbook.sheets[0].column_count == 3
    header = parse(b'name,age')
    assert header.workbook.csv_profile.row_count == 0
    assert all(c.inferred_type == 'unknown' and c.missing_count == 0 for c in header.workbook.csv_profile.columns)
    assert parse(b'value\n42\n').workbook.csv_profile.delimiter is None
    assert parse(b'"a;b"\n"c;d"').status == 'SUCCEEDED'


def test_blank_records_and_duplicate_names_have_stable_locations():
    result = parse(b',,,\nx,x,,x_2\n1,2,3,4\n\n')
    assert result.status == 'SUCCEEDED'
    profile = result.workbook.csv_profile
    assert [c.name for c in profile.columns] == ['x','x_2','column_3','x_2_2']
    assert result.workbook.sheets[0].header_row == 2 and profile.row_count == 2
    assert all(c.missing_count == 1 for c in profile.columns)
    assert result.workbook.sheets[0].preview_rows[0].row_number == 1


def test_conservative_inference_dates_exponents_literals_and_long_values():
    result = parse(b'n,date,mixed,id,literal\n-3e2,2026-02-30,true,+001,NA\n2.5,not-a-date,1,000,null')
    assert [c.inferred_type for c in result.workbook.csv_profile.columns] == ['number','text','text','text','text']
    assert all(c.missing_count == 0 for c in result.workbook.csv_profile.columns)
    long = parse(b'a\n'+b'x'*501)
    assert long.workbook.csv_profile.columns[0].inferred_type == 'text'
    assert len(long.workbook.sheets[0].preview_rows[1].cells[0]) == 500


def test_scan_header_column_and_summary_limits():
    assert parse(b'\n\n\na,b\n1,2',ParserLimits(xlsx_rows=2)).failure.code == 'EXTRACTION_LIMIT_EXCEEDED'
    assert parse((','.join('a' for _ in range(16385))).encode()).failure.code == 'EXTRACTION_LIMIT_EXCEEDED'
    assert parse(b'name,value\n1,2',ParserLimits(max_characters=10)).failure.code == 'EXTRACTION_LIMIT_EXCEEDED'
    result = parse((('x'*500)+','+('x'*500)+'\n1,2').encode())
    assert len(result.workbook.csv_profile.columns[1].name) == 500


def test_non_bmp_header_names_and_samples_respect_the_java_metadata_limit():
    label = 'a' + '\U0001f52c'*500
    value = '\U0001f4ca'*500
    result = parse(f'{label},{label}\n{value},{value}'.encode())
    assert result.status == 'SUCCEEDED'
    profile, sheet = result.workbook.csv_profile, result.workbook.sheets[0]
    assert len({c.name for c in profile.columns}) == 2
    for text in [*(c.name for c in profile.columns), *sheet.header_candidate,
                 *(v for c in sheet.columns for v in c.values), *(v for row in sheet.preview_rows for v in row.cells)]:
        assert len(text.encode('utf-16-le')) <= 1000
        assert text.encode().decode() == text
    assert sheet.preview_rows[1].cells[0] == '\U0001f4ca'*250


def test_profile_counts_types_names_and_sheet_relationships_are_validated():
    profile = parse(b'a,b\n1,\n').workbook.csv_profile.model_dump(by_alias=True)
    for change in [dict(rowCount=10),dict(rowScanComplete=False),dict(indexPolicy='ALL_ROWS'),dict(encoding='guess'),dict(profiledRowCount=True)]:
        with pytest.raises(ValidationError): CsvProfile.model_validate(profile | change)
    for change in [dict(columnNumber=0),dict(columnNumber=2),dict(name=''),dict(missingCount=2),dict(inferredType='unknown'),dict(inferredType='formula')]:
        mutated=json.loads(json.dumps(profile));mutated['columns'][0].update(change)
        with pytest.raises(ValidationError): CsvProfile.model_validate(mutated)
    mutated=json.loads(json.dumps(profile));mutated['columns'][1]['name']='a'
    with pytest.raises(ValidationError): CsvProfile.model_validate(mutated)
    workbook=parse(b'a,b\n1,\n').workbook.model_dump(by_alias=True)
    for change in [dict(name='Foreign'),dict(headerRow=None),dict(columnCount=0),dict(sampledRows=9),dict(rowCountEstimate=None),dict(truncated=True),dict(columns=[])]:
        mutated=json.loads(json.dumps(workbook));mutated['sheets'][0].update(change)
        with pytest.raises(ValidationError): WorkbookMetadata.model_validate(mutated)
    mutated=json.loads(json.dumps(workbook));mutated['sheets']=[]
    with pytest.raises(ValidationError): WorkbookMetadata.model_validate(mutated)


def test_shared_csv_fixture_round_trips():
    path=Path(__file__).resolve().parents[2]/'contracts/processing/v4/source-ingest-result-csv.json'
    result=SourceIngestResult.model_validate_json(path.read_text())
    assert result.workbook.csv_profile.schema_version == '1.0'
    assert result.model_dump(mode='json',by_alias=True) == json.loads(path.read_text())
