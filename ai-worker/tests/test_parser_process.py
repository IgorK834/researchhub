from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from io import BytesIO, StringIO
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import threading
from unittest.mock import patch
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED

import pytest

from researchhub_worker.contracts import SourceIngestCommand, SourceIngestResult
from researchhub_worker.parser_process import IsolatedSourceParser, ProcessLimits, RESULT_BYTES, _apply_limits, _child
from researchhub_worker.parsing import DownloadFailure
from researchhub_worker.parsing.common import ParserLimits, ParseFailure, check_office_archive
from researchhub_worker.processor import IdempotentSourceIngestProcessor


def command(kind='TXT'):
    payload = json.loads((Path(__file__).parents[2] / 'contracts/processing/v4/source-ingest-request.json').read_text())
    payload['sourceType'] = kind
    payload['fileAccess']['expiresAt'] = (datetime.now(timezone.utc) + timedelta(minutes=5)).isoformat()
    return SourceIngestCommand.model_validate(payload)


def child(code, timeout=5):
    return IsolatedSourceParser(ProcessLimits(timeout_seconds=timeout, cpu_seconds=1),
                                child_command=[sys.executable, '-c', code])


def test_timeout_terminates_child_and_failed_redelivery_is_cached():
    parser = child('import time; time.sleep(30)', timeout=1)
    processor = IdempotentSourceIngestProcessor(parser)
    result = processor.process(command())
    assert result.result.failure.code == 'EXTRACTION_TIMEOUT'
    assert processor.process(command()).duplicate


def test_cpu_and_output_limits_terminate_real_child():
    prefix = 'from researchhub_worker.parser_process import _apply_limits, ProcessLimits; _apply_limits(ProcessLimits(cpu_seconds=1)); '
    cpu = child(prefix + 'exec("while True: pass")')
    assert cpu(command()).failure.code == 'EXTRACTION_RESOURCE_LIMIT_EXCEEDED'
    output = child(prefix + 'import sys; sys.stdout.write("x" * (5 * 1024 * 1024)); sys.stdout.flush()')
    assert output(command()).failure.code == 'EXTRACTION_RESOURCE_LIMIT_EXCEEDED'


def test_result_size_identity_and_malformed_output_are_bounded():
    assert child('print("x" * (4 * 1024 * 1024 + 1))')(command()).failure.code == 'EXTRACTION_LIMIT_EXCEEDED'
    for body in ('not-json', '{}', '{"password":"private"}'):
        result = child(f'print({body!r})')(command())
        assert result.failure.code == 'DOCUMENT_PARSE_FAILED'
        assert 'private' not in result.model_dump_json()
    bad = SourceIngestResult.empty_success(command()).model_dump(mode='json', by_alias=True)
    bad['sourceId'] = '00000000-0000-0000-0000-000000000001'
    assert child(f'print({json.dumps(bad)!r})')(command()).failure.code == 'DOCUMENT_PARSE_FAILED'


def test_child_has_no_provider_credentials_or_service_token(monkeypatch):
    monkeypatch.setenv('FOUNDRY_API_KEY', 'private-key')
    monkeypatch.setenv('AI_WORKER_SERVICE_TOKEN', 'private-token')
    code = '''import json, os, sys
from researchhub_worker.contracts import SourceIngestCommand, SourceIngestResult
assert 'FOUNDRY_API_KEY' not in os.environ and 'AI_WORKER_SERVICE_TOKEN' not in os.environ
work = SourceIngestCommand.model_validate_json(sys.stdin.buffer.read())
print(SourceIngestResult.empty_success(work).model_dump_json(by_alias=True))'''
    assert child(code)(command()).status == 'SUCCEEDED'
    with pytest.raises(DownloadFailure):
        child('print(\'{"downloadFailed":true}\')')(command())


def test_actual_parser_handles_malformed_pdf_then_valid_text_in_separate_processes():
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            self.send_response(200); self.end_headers()
            self.wfile.write(b'%PDF-1.7\nmalformed' if self.path == '/broken' else 'Safe λ claim'.encode())
        def log_message(self, *_args): pass
    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
    try:
        parser = IsolatedSourceParser()
        def work(kind, path):
            original = command(kind)
            return SourceIngestCommand.model_validate(original.model_dump(by_alias=True) | {'fileAccess': original.file_access.model_dump(by_alias=True) | {'url': f'http://127.0.0.1:{server.server_port}/{path}'}})
        broken = parser(work('PDF', 'broken'))
        assert broken.status == 'FAILED' and broken.failure.code == 'DOCUMENT_PARSE_FAILED'
        text = parser(work('TXT', 'text'))
        assert text.status == 'SUCCEEDED' and text.chunks[0].text == 'Safe λ claim'
        assert text.extraction_metadata.content_sha256
    finally:
        server.shutdown(); server.server_close(); thread.join()


def test_process_limit_validation_and_linux_memory_boundary(monkeypatch):
    for kwargs in ({'timeout_seconds': 0}, {'timeout_seconds': 26}, {'cpu_seconds': 0}, {'cpu_seconds': 21}, {'memory_mib': 127}, {'memory_mib': 1025}):
        with pytest.raises(ValueError): ProcessLimits(**kwargs)
    monkeypatch.setenv('AI_WORKER_PARSE_TIMEOUT_SECONDS', '3')
    assert ProcessLimits.from_env().timeout_seconds == 3
    import resource
    with patch.object(resource, 'setrlimit') as limits:
        monkeypatch.setattr(sys, 'platform', 'linux')
        _apply_limits(ProcessLimits(memory_mib=256))
        limits.assert_any_call(resource.RLIMIT_AS, (256 * 1024 * 1024, 256 * 1024 * 1024))


@pytest.mark.parametrize('download_failure', [False, True])
def test_child_entry_emits_only_validated_payload(monkeypatch, download_failure):
    monkeypatch.setattr('researchhub_worker.parser_process._apply_limits', lambda _: None)
    monkeypatch.setattr(sys, 'stdin', type('Input', (), {'buffer': BytesIO(command().model_dump_json(by_alias=True).encode())})())
    output = StringIO(); monkeypatch.setattr(sys, 'stdout', output)
    def parse(work):
        if download_failure: raise DownloadFailure('private transport detail')
        return SourceIngestResult.empty_success(work)
    monkeypatch.setattr('researchhub_worker.parsing.SourceParser', lambda: parse)
    _child()
    value = json.loads(output.getvalue())
    assert value == {'downloadFailed': True} if download_failure else value['status'] == 'SUCCEEDED'


def archive(entries):
    output = BytesIO()
    with ZipFile(output, 'w', compression=ZIP_DEFLATED) as zip:
        zip.writestr('[Content_Types].xml', '<Types/>')
        for name, value in entries:
            zip.writestr(name, value)
    return output.getvalue()


@pytest.mark.parametrize('name', ['../outside', '/absolute', 'C:disk', 'a\\b', 'a'*513])
def test_office_archive_rejects_unsafe_entries(name):
    with pytest.raises(ParseFailure, match='unsupported entries'):
        check_office_archive(archive([(name, 'x')]), ParserLimits())


def test_office_duplicate_symlink_bomb_and_xml_entity_checks():
    with pytest.warns(UserWarning):
        data = archive([('same', 'x'), ('same', 'y')])
    with pytest.raises(ParseFailure): check_office_archive(data, ParserLimits())
    link = ZipInfo('link'); link.create_system = 3; link.external_attr = 0o120777 << 16
    with pytest.raises(ParseFailure): check_office_archive(archive([(link, 'target')]), ParserLimits())
    with pytest.raises(ParseFailure): check_office_archive(archive([('huge', 'x' * 2_000_000)]), ParserLimits())
    for xml in ('x'*65537, '<!DOCTYPE Types [<!ENTITY x SYSTEM "file:///etc/passwd">]><Types/>'):
        output = BytesIO()
        with ZipFile(output, 'w') as zip: zip.writestr('[Content_Types].xml', xml)
        with pytest.raises(Exception): check_office_archive(output.getvalue(), ParserLimits())


def test_office_default_content_type_cannot_hide_macros_in_character_references():
    output = BytesIO()
    with ZipFile(output, 'w') as zip:
        zip.writestr('[Content_Types].xml', "<Types><Default Extension='bin' ContentType='application/vnd.ms-office.vba&#80;roject'/></Types>")
    with pytest.raises(ParseFailure) as error:
        check_office_archive(output.getvalue(), ParserLimits())
    assert error.value.code == 'UNSUPPORTED_MACROS'


def test_invalid_extraction_configuration_fails_before_accepting_jobs(monkeypatch):
    monkeypatch.setenv('AI_WORKER_MAX_FILE_BYTES', '52428801')
    with pytest.raises(ValueError, match='parser limit'):
        IsolatedSourceParser()
