"""Minimal authenticated FastAPI surface for asynchronous AI/data processing."""

from __future__ import annotations

import json
import logging
import os
import secrets
from typing import Any

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool
from starlette.exceptions import HTTPException as StarletteHttpException

from .contracts import ContractError, parse_source_ingest
from .processor import IdempotencyConflict, IdempotentSourceIngestProcessor

LOGGER = logging.getLogger(__name__)
MAX_REQUEST_BYTES = 16 * 1024
MIN_SERVICE_TOKEN_LENGTH = 32
SOURCE_INGEST_PATH = "/internal/jobs/source-ingest"


def create_app(
    processor: IdempotentSourceIngestProcessor | None = None,
    service_token: str | None = None,
) -> FastAPI:
    """Build the internal worker API; fail closed when no service credential exists."""
    expected_token = _service_token(service_token)
    app = FastAPI(
        title="ResearchHub AI worker",
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
    )
    worker = processor or IdempotentSourceIngestProcessor()

    @app.middleware("http")
    async def prevent_response_caching(request: Request, call_next: Any) -> JSONResponse:
        response = await call_next(request)
        response.headers["Cache-Control"] = "no-store"
        return response

    @app.exception_handler(StarletteHttpException)
    async def safe_http_error(_request: Request, failure: StarletteHttpException) -> JSONResponse:
        if failure.status_code == 404:
            return JSONResponse(status_code=404, content={"error": "Not found"})
        if failure.status_code == 405:
            return JSONResponse(status_code=405, content={"error": "Method not allowed"})
        return JSONResponse(status_code=failure.status_code, content={"error": "Request failed"})

    @app.get("/health", include_in_schema=False)
    async def health() -> dict[str, str]:
        return {"status": "UP"}

    @app.post(SOURCE_INGEST_PATH, include_in_schema=False)
    async def source_ingest(request: Request) -> JSONResponse:
        if not _authorized(request, expected_token):
            return JSONResponse(
                status_code=401,
                content={"error": "Unauthorized"},
                headers={"WWW-Authenticate": "Bearer"},
            )
        try:
            command = parse_source_ingest(await _request_json(request))
            processed = await run_in_threadpool(worker.process, command)
            return JSONResponse(
                status_code=200,
                content=processed.result.model_dump(mode="json", by_alias=True),
            )
        except ContractError as invalid:
            return JSONResponse(status_code=400, content={"error": str(invalid)})
        except IdempotencyConflict as conflict:
            return JSONResponse(status_code=409, content={"error": str(conflict)})
        except Exception:
            LOGGER.exception("source-ingest processing failed")
            return JSONResponse(status_code=500, content={"error": "Processing failed"})

    return app


def _service_token(provided: str | None) -> str:
    token = provided if provided is not None else os.getenv("AI_WORKER_SERVICE_TOKEN")
    if token is None or len(token) < MIN_SERVICE_TOKEN_LENGTH or token.strip() != token:
        raise RuntimeError("AI_WORKER_SERVICE_TOKEN must contain at least 32 non-whitespace characters")
    return token


def _authorized(request: Request, expected_token: str) -> bool:
    scheme, separator, credential = request.headers.get("Authorization", "").partition(" ")
    return (
        separator == " "
        and scheme.lower() == "bearer"
        and bool(credential)
        and secrets.compare_digest(credential, expected_token)
    )


async def _request_json(request: Request) -> Any:
    content_type = request.headers.get("Content-Type", "").partition(";")[0].strip().lower()
    if content_type != "application/json":
        raise ContractError("Content-Type must be application/json")

    raw_length = request.headers.get("Content-Length")
    try:
        declared_length = int(raw_length or "")
    except ValueError as invalid:
        raise ContractError("Content-Length is required") from invalid
    if declared_length < 1 or declared_length > MAX_REQUEST_BYTES:
        raise ContractError("Request body size is invalid")

    body = await request.body()
    if len(body) != declared_length or len(body) > MAX_REQUEST_BYTES:
        raise ContractError("Request body size is invalid")
    try:
        return json.loads(body)
    except (UnicodeDecodeError, json.JSONDecodeError) as invalid:
        raise ContractError("Request body must contain valid JSON") from invalid
