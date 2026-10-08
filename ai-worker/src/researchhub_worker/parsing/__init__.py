"""Source ingestion: bounded download, format dispatch and provenance-preserving results."""
from datetime import datetime, timezone
import hashlib
import os
from urllib.parse import urlsplit, urlunsplit
from urllib.request import Request, build_opener, HTTPRedirectHandler
from urllib.error import URLError

from ..contracts import DocumentStructure, ExtractionMetadata, ProcessingFailure, SourceIngestResult, UnitLocation
from .common import ParserLimits, ParseFailure, TextBuilder
from .pdf import parse_pdf
from .docx import parse_docx
from .xlsx import parse_xlsx
from .csv import parse_csv
from ..retrieval import chunk_extraction
from ..retrieval.contracts import ChunkingConfig


class DownloadFailure(RuntimeError):
    """Transient delivery error; never exposes signed URLs and is not cached."""


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def _download_url(url):
    # Optional, explicit origin translation for local Compose: Spring runs on the host,
    # the worker on Docker's network. SAS path/query remain byte-for-byte intact.
    origin = os.getenv('AI_WORKER_BLOB_URL_ORIGIN')
    target = os.getenv('AI_WORKER_BLOB_URL_TARGET_ORIGIN')
    if bool(origin) != bool(target):
        raise DownloadFailure('Both local blob URL origins must be configured.')
    if not origin:
        return url
    source_parts, target_parts, parts = urlsplit(origin), urlsplit(target), urlsplit(url)
    for configured in (source_parts, target_parts):
        if configured.scheme not in ('http', 'https') or not configured.netloc or configured.path not in ('', '/') or configured.query or configured.fragment or configured.username:
            raise DownloadFailure('Invalid local blob URL origin configuration.')
    if (parts.scheme, parts.netloc) == (source_parts.scheme, source_parts.netloc):
        return urlunsplit((target_parts.scheme, target_parts.netloc, parts.path, parts.query, parts.fragment))
    return url


def download(command, limits):
    if command.file_access.expires_at <= datetime.now(timezone.utc):
        raise DownloadFailure('Temporary source access has expired.')
    request = Request(_download_url(str(command.file_access.url)), headers={'Accept': 'application/octet-stream'})
    try:
        with build_opener(_NoRedirect).open(request, timeout=30) as response:
            content = response.read(limits.max_file_bytes + 1)
    except (OSError, URLError, ValueError):
        raise DownloadFailure('The source file could not be downloaded.') from None
    if len(content) > limits.max_file_bytes:
        raise ParseFailure('EXTRACTION_LIMIT_EXCEEDED', 'The source exceeds the configured file limit.')
    return content


class SourceParser:
    def __init__(self, limits=None, downloader=download, chunking=None):
        self.limits = limits or ParserLimits.from_env()
        self.downloader = downloader
        self.chunking = chunking if chunking is not None else ChunkingConfig.from_env()

    def __call__(self, command):
        base = dict(schema_version=command.schema_version, job_id=command.job_id,
                    workspace_id=command.workspace_id, source_id=command.source_id,
                    processing_version=command.requested_processing_version)
        try:
            data = self.downloader(command, self.limits)
            if command.source_type == 'TXT':
                builder = TextBuilder(command.source_id, 'utf8-stdlib/rh-1', self.limits)
                builder.add(data.decode('utf-8-sig'), UnitLocation(kind='TEXT'))
                if not builder.position:
                    raise ParseFailure('EMPTY_DOCUMENT', 'The source contains no extractable text.')
                parsed = builder, [], [], None, [], None, None
            else:
                parser = {'PDF': parse_pdf, 'DOCX': parse_docx, 'XLSX': parse_xlsx, 'CSV': parse_csv}[command.source_type]
                parsed = parser(data, command.source_id, self.limits)
            builder, pages, sections, workbook, warnings, title, author = parsed
            result = SourceIngestResult.model_construct(**base, status='SUCCEEDED', parser_version=builder.version,
                extraction_metadata=ExtractionMetadata(title=title, author=author, page_count=len(pages),
                    character_count=builder.position, content_sha256=hashlib.sha256(data).hexdigest()),
                structure=DocumentStructure(pages=pages, sections=sections), chunks=builder.chunks,
                workbook=workbook, warnings=warnings, failure=None)
            payload = result.model_dump()
            payload['retrieval'] = chunk_extraction(result, self.chunking).model_dump()
            result = SourceIngestResult.model_validate(payload)
            if len(result.model_dump_json(by_alias=True).encode('utf-8')) > 4 * 1024 * 1024:
                raise ParseFailure('EXTRACTION_LIMIT_EXCEEDED', 'The extraction result exceeds the response limit.')
            return result
        except DownloadFailure:
            raise
        except Exception as error:
            failure = error if isinstance(error, ParseFailure) else ParseFailure('DOCUMENT_PARSE_FAILED', 'The document could not be read.')
            return SourceIngestResult(**base, status='FAILED', extraction_metadata=None,
                structure=DocumentStructure(pages=[], sections=[]), chunks=[], warnings=[],
                failure=ProcessingFailure(code=failure.code, message=failure.message))
