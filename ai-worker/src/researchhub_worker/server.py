"""Minimal internal HTTP server for local asynchronous processing."""

from __future__ import annotations

import json
import logging
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

from .contracts import ContractError, SourceIngestCommand
from .processor import IdempotencyConflict, IdempotentSourceIngestProcessor

LOGGER = logging.getLogger(__name__)
MAX_REQUEST_BYTES = 16 * 1024
SOURCE_INGEST_PATH = "/internal/jobs/source-ingest"


class WorkerHttpServer(ThreadingHTTPServer):
    processor: IdempotentSourceIngestProcessor


def create_server(
    host: str,
    port: int,
    processor: IdempotentSourceIngestProcessor | None = None,
) -> WorkerHttpServer:
    server = WorkerHttpServer((host, port), WorkerRequestHandler)
    server.processor = processor or IdempotentSourceIngestProcessor()
    return server


class WorkerRequestHandler(BaseHTTPRequestHandler):
    server: WorkerHttpServer

    def do_GET(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler API
        if self.path == "/healthz":
            self._json(HTTPStatus.OK, {"status": "UP"})
        else:
            self._json(HTTPStatus.NOT_FOUND, {"error": "Not found"})

    def do_POST(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler API
        if self.path != SOURCE_INGEST_PATH:
            self._json(HTTPStatus.NOT_FOUND, {"error": "Not found"})
            return
        try:
            command = SourceIngestCommand.from_json(self._request_json())
            result = self.server.processor.process(command)
            self._json(HTTPStatus.OK, {"accepted": True, "duplicate": result.duplicate})
        except ContractError as invalid:
            self._json(HTTPStatus.BAD_REQUEST, {"error": str(invalid)})
        except IdempotencyConflict as conflict:
            self._json(HTTPStatus.CONFLICT, {"error": str(conflict)})
        except Exception:
            LOGGER.exception("source-ingest processing failed")
            self._json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": "Processing failed"})

    def _request_json(self) -> Any:
        content_type = self.headers.get_content_type()
        if content_type != "application/json":
            raise ContractError("Content-Type must be application/json")
        raw_length = self.headers.get("Content-Length")
        try:
            length = int(raw_length or "")
        except ValueError as invalid:
            raise ContractError("Content-Length is required") from invalid
        if length < 1 or length > MAX_REQUEST_BYTES:
            raise ContractError("Request body size is invalid")
        try:
            return json.loads(self.rfile.read(length))
        except (UnicodeDecodeError, json.JSONDecodeError) as invalid:
            raise ContractError("Request body must contain valid JSON") from invalid

    def _json(self, status: HTTPStatus, payload: dict[str, object]) -> None:
        body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format: str, *args: object) -> None:
        LOGGER.info("worker_http %s", format % args)
