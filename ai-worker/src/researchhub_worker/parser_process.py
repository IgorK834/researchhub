"""Killable, bounded parsing boundary. Uploaded documents never run in the API process."""
from __future__ import annotations

from dataclasses import dataclass
import json
import os
import signal
import subprocess
import sys
import tempfile

RESULT_BYTES = 4 * 1024 * 1024


@dataclass(frozen=True)
class ProcessLimits:
    timeout_seconds: int = 20
    cpu_seconds: int = 15
    memory_mib: int = 512

    def __post_init__(self):
        if not (1 <= self.timeout_seconds <= 25 and 1 <= self.cpu_seconds <= 20
                and 128 <= self.memory_mib <= 1024):
            raise ValueError('Invalid parser process resource limits')

    @classmethod
    def from_env(cls):
        return cls(**{field: int(os.getenv('AI_WORKER_PARSE_' + field.upper(), str(default)))
                      for field, default in [('timeout_seconds', 20), ('cpu_seconds', 15), ('memory_mib', 512)]})


def _failure(command, code, message):
    from .contracts import DocumentStructure, ProcessingFailure, SourceIngestResult
    return SourceIngestResult(schema_version=command.schema_version, job_id=command.job_id,
        workspace_id=command.workspace_id, source_id=command.source_id,
        processing_version=command.requested_processing_version, status='FAILED',
        extraction_metadata=None, structure=DocumentStructure(pages=[], sections=[]), chunks=[], warnings=[],
        failure=ProcessingFailure(code=code, message=message))


class IsolatedSourceParser:
    """Local subprocess adapter. Child command is injectable only by trusted application/test code."""
    def __init__(self, limits=None, *, child_command=None):
        self.limits = limits or ProcessLimits.from_env()
        # Preserve fail-fast startup validation, even though parsing itself runs only in the child.
        from .parsing.common import ParserLimits
        from .retrieval.contracts import ChunkingConfig
        ParserLimits.from_env()
        ChunkingConfig.from_env()
        self._command = child_command or [sys.executable, '-m', 'researchhub_worker.parser_process']

    def __call__(self, command):
        from .contracts import SourceIngestResult
        from .parsing import DownloadFailure
        # The parser receives extraction settings, never model credentials or the worker service token.
        env = {key: value for key, value in os.environ.items()
               if key in ('PATH', 'PYTHONPATH', 'LANG', 'LC_ALL', 'SYSTEMROOT')
               or key.startswith(('AI_WORKER_MAX_', 'AI_WORKER_XLSX_', 'AI_WORKER_CHUNK_', 'AI_WORKER_BLOB_URL_'))
               or key == 'AI_WORKER_PREVIEW_ROWS'}
        env.update(PYTHONDONTWRITEBYTECODE='1', AI_WORKER_PARSE_CPU_SECONDS=str(self.limits.cpu_seconds),
                   AI_WORKER_PARSE_MEMORY_MIB=str(self.limits.memory_mib),
                   AI_WORKER_PARSE_TIMEOUT_SECONDS=str(self.limits.timeout_seconds))
        # Files avoid unbounded communicate() buffers and pipe deadlocks. The child's file-size limit
        # bounds stdout AND diagnostics. Only a bounded, validated result is read into the API process.
        with tempfile.TemporaryFile() as output, tempfile.TemporaryFile() as diagnostics:
            process = subprocess.Popen(self._command, stdin=subprocess.PIPE, stdout=output,
                                       stderr=diagnostics, env=env, start_new_session=True)
            try:
                process.communicate(command.model_dump_json(by_alias=True).encode(),
                                    timeout=self.limits.timeout_seconds)
            except subprocess.TimeoutExpired:
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                process.wait()
                return _failure(command, 'EXTRACTION_TIMEOUT', 'The document took too long to read.')
            if process.returncode != 0:
                return _failure(command, 'EXTRACTION_RESOURCE_LIMIT_EXCEEDED',
                                'The document exceeded the parser resource limits.')
            output.seek(0)
            payload = output.read(RESULT_BYTES + 1)
            if len(payload) > RESULT_BYTES:
                return _failure(command, 'EXTRACTION_LIMIT_EXCEEDED', 'The extraction result exceeds the response limit.')
            try:
                value = json.loads(payload)
                if value == {'downloadFailed': True}:
                    raise DownloadFailure('The source file could not be downloaded.')
                result = SourceIngestResult.model_validate(value)
                result.validate_identity(command)
                return result
            except DownloadFailure:
                raise
            except Exception:
                return _failure(command, 'DOCUMENT_PARSE_FAILED', 'The document could not be read.')


def _apply_limits(limits):
    import resource
    resource.setrlimit(resource.RLIMIT_CPU, (limits.cpu_seconds, limits.cpu_seconds))
    resource.setrlimit(resource.RLIMIT_FSIZE, (RESULT_BYTES + 65_536, RESULT_BYTES + 65_536))
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    # RLIMIT_AS is effective on Linux (the supported worker container). macOS uses the container's
    # memory bound when deployed; its host kernel does not implement this limit reliably.
    if sys.platform.startswith('linux'):
        memory = limits.memory_mib * 1024 * 1024
        resource.setrlimit(resource.RLIMIT_AS, (memory, memory))


def _child():
    _apply_limits(ProcessLimits.from_env())
    from .contracts import SourceIngestCommand
    from .parsing import SourceParser, DownloadFailure
    command = SourceIngestCommand.model_validate_json(sys.stdin.buffer.read(16_385))
    try:
        result = SourceParser()(command)
        payload = result.model_dump_json(by_alias=True)
    except DownloadFailure:
        payload = '{"downloadFailed":true}'
    sys.stdout.write(payload)


if __name__ == '__main__':
    _child()
