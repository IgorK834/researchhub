import copy
import hashlib
import json
import os
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
import protocol as p
import run

VERSION = '00000000-0000-4000-8000-000000000001'


@pytest.fixture
def layout(tmp_path):
    execution, inputs, outputs = (tmp_path / name for name in ('execution', 'inputs', 'outputs'))
    for root in (execution, inputs, outputs):
        root.mkdir()
    content = b'frequency,voltage,current\n1,2,0.5\n'
    (inputs / (VERSION + '.csv')).write_bytes(content)
    manifest = {'schemaVersion': '1.0', 'inputs': [{'sourceVersionId': VERSION, 'format': 'CSV',
        'file': '/inputs/' + VERSION + '.csv', 'sha256': hashlib.sha256(content).hexdigest()}],
        'outputs': [{'name': 'table', 'kind': 'TABLE'}, {'name': 'chart', 'kind': 'CHART'}, {'name': 'text', 'kind': 'TEXT'}]}
    (execution / 'manifest.json').write_text(json.dumps(manifest))
    (execution / 'code.py').write_text('# inert test program')
    return execution, inputs, outputs, manifest


def result(outputs, value=None):
    value = value or {'schemaVersion': '1.0', 'outputs': [
        {'name': 'table', 'kind': 'TABLE', 'columns': ['f', 'Z'], 'rows': [[1.0, 4], [None, True], ['note', 2.5]]},
        {'name': 'chart', 'kind': 'CHART', 'file': 'chart.png'}, {'name': 'text', 'kind': 'TEXT', 'text': 'Computed.'}]}
    (outputs / 'chart.png').write_bytes(b'\x89PNG\r\n\x1a\n')
    (outputs / 'result.json').write_text(json.dumps(value))
    return value


def rich_result(outputs):
    value = {'schemaVersion': '2.0', 'outputs': [
        {'name': 'chart', 'kind': 'CHART', 'file': 'chart.png', 'title': 'Impedance versus frequency',
         'xAxis': {'label': 'Frequency', 'unit': 'Hz', 'scale': 'LOG'},
         'yAxis': {'label': 'Magnitude', 'unit': 'Ω', 'scale': 'LOG'},
         'series': [{'name': 'Z', 'tableName': 'table', 'xColumn': 'f', 'yColumn': 'Z', 'yTransform': 'ABS'}]},
        {'name': 'table', 'kind': 'TABLE', 'columns': ['f', 'Z'], 'rows': [[1, -2], [2, 4], [None, 2]]},
        {'name': 'text', 'kind': 'TEXT', 'text': 'Calculated.'}]}
    result(outputs, value)
    return value


def test_rich_chart_references_actual_saved_columns_and_accepts_legacy_results(layout):
    _, _, outputs, manifest = layout
    expected = rich_result(outputs)
    assert p.validate_result(manifest, outputs) == expected
    expected['outputs'][0]['series'][0]['yTransform'] = 'IDENTITY'
    expected['outputs'][1]['rows'] = [[1, 2]]
    result(outputs, expected)
    assert p.validate_result(manifest, outputs) == expected
    expected['outputs'][0]['series'] = []
    expected['outputs'][0]['xAxis']['unit'] = None
    result(outputs, expected)
    assert p.validate_result(manifest, outputs) == expected


@pytest.mark.parametrize('mutate', [
    lambda chart, table: chart.update(title=' '), lambda chart, table: chart.update(sourceAnalysisId='forged'),
    lambda chart, table: chart['xAxis'].update(scale='PYTHON'), lambda chart, table: chart['yAxis'].update(unit={}),
    lambda chart, table: chart.update(series={}), lambda chart, table: chart.update(series=chart['series'] * 11),
    lambda chart, table: chart['series'][0].update(tableName='unknown'), lambda chart, table: chart['series'][0].update(xColumn='unknown'),
    lambda chart, table: chart['series'][0].update(yTransform='PYTHON'), lambda chart, table: chart['series'][0].update(pointCount=42),
    lambda chart, table: chart['series'].append(copy.deepcopy(chart['series'][0])),
    lambda chart, table: table.update(rows=[[0, 4]]), lambda chart, table: table.update(rows=[[1, 'text']]),
    lambda chart, table: chart['series'][0].update(yTransform='IDENTITY'),
])
def test_rich_chart_rejects_invalid_metadata_and_unbound_or_non_numeric_series(layout, mutate):
    _, _, outputs, manifest = layout
    value = rich_result(outputs)
    mutate(value['outputs'][0], value['outputs'][1])
    result(outputs, value)
    with pytest.raises(p.ProtocolError):
        p.validate_result(manifest, outputs)


def test_valid_manifest_result_and_xlsx(layout):
    execution, inputs, outputs, manifest = layout
    assert p.validate_manifest(execution / 'manifest.json', inputs) == manifest
    expected = result(outputs)
    assert p.validate_result(manifest, outputs) == expected
    manifest['inputs'][0].update(format='XLSX', file='/inputs/' + VERSION + '.xlsx')
    (inputs / (VERSION + '.csv')).rename(inputs / (VERSION + '.xlsx'))
    (execution / 'manifest.json').write_text(json.dumps(manifest))
    assert p.validate_manifest(execution / 'manifest.json', inputs) == manifest


@pytest.mark.parametrize('mutate', [
    lambda v: v.update(schemaVersion='2.0'), lambda v: v.update(inputs=[]), lambda v: v.update(inputs='wrong'),
    lambda v: v.update(extra=1), lambda v: v['inputs'][0].update(extra=1),
    lambda v: v['inputs'][0].update(sourceVersionId='oops'), lambda v: v['inputs'][0].update(sourceVersionId='ABCDEF00-0000-4000-8000-000000000001'),
    lambda v: v['inputs'][0].update(file='/etc/passwd'), lambda v: v['inputs'][0].update(format='PDF'),
    lambda v: v['inputs'][0].update(sha256='z'*64), lambda v: v['inputs'][0].update(sha256='a'*64),
    lambda v: v['inputs'].append(copy.deepcopy(v['inputs'][0])), lambda v: v.update(outputs=[]),
    lambda v: v.update(outputs=None), lambda v: v['outputs'][0].update(name=' '),
    lambda v: v['outputs'][0].update(name='\x00bad'), lambda v: v['outputs'][0].update(kind='FILE'),
    lambda v: v['outputs'].append(copy.deepcopy(v['outputs'][0])), lambda v: v['outputs'][0].update(extra=1),
])
def test_bad_manifest_fails_closed(layout, mutate):
    execution, inputs, _, manifest = layout
    mutate(manifest)
    (execution / 'manifest.json').write_text(json.dumps(manifest))
    with pytest.raises(p.ProtocolError):
        p.validate_manifest(execution / 'manifest.json', inputs)


@pytest.mark.parametrize('data', [b'{"x":1,"x":2}', b'{"x":NaN}', b'{} trailing', b'\xff'])
def test_json_rejects_duplicate_nonfinite_trailing_invalid_encoding(tmp_path, data):
    path = tmp_path / 'json'; path.write_bytes(data)
    with pytest.raises(p.ProtocolError):
        p.load_json(path, 100)


def test_file_caps_links_and_directories(tmp_path):
    path = tmp_path / 'file'; path.write_bytes(b'abcd')
    assert p.regular_file(path, 4) == b'abcd'
    with pytest.raises(p.ProtocolError): p.regular_file(path, 3)
    link = tmp_path / 'link'; link.symlink_to(path)
    with pytest.raises(p.ProtocolError): p.regular_file(link, 100)
    with pytest.raises(p.ProtocolError): p.regular_file(tmp_path, 100)
    os.link(path, tmp_path / 'hardlink')
    with pytest.raises(p.ProtocolError): p.regular_file(path, 100)


@pytest.mark.parametrize('mutate', [
    lambda v: v.update(extra=1), lambda v: v.update(schemaVersion='2'), lambda v: v.update(outputs=None),
    lambda v: v['outputs'].pop(), lambda v: v['outputs'].__setitem__(0, 7),
    lambda v: v['outputs'][0].update(name='wrong'), lambda v: v['outputs'][0].update(kind='TEXT'),
    lambda v: v['outputs'][1].update(name='table'), lambda v: v['outputs'][0].update(columns=[]),
    lambda v: v['outputs'][0].update(columns=['x']*101), lambda v: v['outputs'][0].update(columns=['x','x']),
    lambda v: v['outputs'][0].update(columns=[True,'x']), lambda v: v['outputs'][0].update(rows=None),
    lambda v: v['outputs'][0].update(rows=[[1,2]]*10001), lambda v: v['outputs'][0].update(rows=[1]),
    lambda v: v['outputs'][0].update(rows=[[1]]), lambda v: v['outputs'][0].update(rows=[[1,{}]]),
    lambda v: v['outputs'][0].update(rows=[[1,'x'*1025]]), lambda v: v['outputs'][0].update(rows=[[1,float('inf')]]),
    lambda v: v['outputs'][2].update(text='x'*65537), lambda v: v['outputs'][1].update(file='../chart.png'),
    lambda v: v['outputs'][1].update(file='chart.jpg'), lambda v: v['outputs'][1].update(extra=1),
])
def test_invalid_results(layout, mutate):
    _, _, outputs, manifest = layout
    value = result(outputs); mutate(value); result(outputs, value)
    with pytest.raises(p.ProtocolError): p.validate_result(manifest, outputs)


def test_total_cell_limit_and_unlisted_files(layout):
    _, _, outputs, manifest = layout
    value = result(outputs)
    value['outputs'][0].update(columns=[str(x) for x in range(100)], rows=[[0]*100]*1001)
    result(outputs, value)
    with pytest.raises(p.ProtocolError): p.validate_result(manifest, outputs)
    result(outputs)
    (outputs / 'extra').write_text('unknown')
    with pytest.raises(p.ProtocolError): p.validate_result(manifest, outputs)


@pytest.mark.parametrize('svg', [
    '<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>',
    '<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]><svg/>',
    '<svg onload="alert(1)"/>', '<svg><use href="https://example.com/a"/></svg>',
    '<svg><path fill="url(https://example.com/a)"/></svg>', '<svg><image href="#x"/></svg>',
    '<html/>', '<svg',
])
def test_active_or_invalid_svg_rejected(svg):
    with pytest.raises(p.ProtocolError): p.chart(svg.encode(), '.svg')


def test_inert_svg_and_bad_png():
    p.chart(b'<svg xmlns="http://www.w3.org/2000/svg"><defs><clipPath id="clip"/></defs><path fill="url(#clip)"/><use href="#clip"/></svg>', '.svg')
    with pytest.raises(p.ProtocolError): p.chart(b'not an image', '.png')


def test_execute_uses_subprocess_with_fixed_environment_and_paths(layout, monkeypatch):
    execution, inputs, outputs, _ = layout
    monkeypatch.setenv('APP_DATABASE_PASSWORD', 'must not reach code')
    def invoke(command, **kwargs):
        assert command[1] == '-I' and command[2] == str(execution / 'code.py')
        assert kwargs['cwd'] == execution and kwargs['env'] == run.CHILD_ENV
        assert 'APP_DATABASE_PASSWORD' not in kwargs['env']
        result(outputs)
        return SimpleNamespace(returncode=0)
    monkeypatch.setattr(run.subprocess, 'run', invoke)
    assert run.execute(execution, inputs, outputs) is None


def test_execute_failed_program_and_preexisting_output(layout, monkeypatch):
    execution, inputs, outputs, _ = layout
    monkeypatch.setattr(run.subprocess, 'run', Mock(return_value=SimpleNamespace(returncode=1)))
    assert run.execute(execution, inputs, outputs) == 1
    (outputs / 'prior').write_text('bad')
    with pytest.raises(p.ProtocolError): run.execute(execution, inputs, outputs)
    (outputs / 'prior').unlink(); (execution / 'code.py').write_text(' ')
    with pytest.raises(p.ProtocolError): run.execute(execution, inputs, outputs)


@pytest.mark.parametrize('failure', [None, 7, 137, p.ProtocolError('secret'), OSError('secret')])
def test_main_only_reports_safe_codes(failure, monkeypatch, capsys):
    monkeypatch.setattr(run.sys, 'argv', ['run.py'])
    mock = Mock(side_effect=failure) if isinstance(failure, Exception) else Mock(return_value=failure)
    monkeypatch.setattr(run, 'execute', mock)
    assert run.main() == (0 if failure is None else failure if type(failure) is int else 65)
    assert 'secret' not in capsys.readouterr().err


def test_main_refuses_arguments(monkeypatch):
    monkeypatch.setattr(run.sys, 'argv', ['run.py', '/arbitrary.py'])
    assert run.main() == 65
