"""Minimal authenticated FastAPI surface for asynchronous AI/data processing."""

from __future__ import annotations

import json
import logging
import os
import secrets
import time

from .observability import WorkerMetrics
from typing import Any

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool
from starlette.exceptions import HTTPException as StarletteHttpException

from .contracts import ContractError, parse_source_ingest
from .processor import IdempotencyConflict, IdempotentSourceIngestProcessor
from .retrieval.embeddings import configured_provider, EmbeddingError
from .ai.contracts import GenerationRequest
from .ai.context import ContextualRequest
from .ai.providers import configured_gateway, ProviderError
from .ai.telemetry import invoke, error_content

LOGGER = logging.getLogger(__name__)
MAX_REQUEST_BYTES = 16 * 1024
MIN_SERVICE_TOKEN_LENGTH = 32
SOURCE_INGEST_PATH = "/internal/jobs/source-ingest"


def create_app(
    processor: IdempotentSourceIngestProcessor | None = None,
    service_token: str | None = None,
    embedding_provider=None,
    model_gateway=None,
) -> FastAPI:
    """Build the internal worker API; fail closed when no service credential exists."""
    expected_token = _service_token(service_token)
    app = FastAPI(
        title="ResearchHub AI worker",
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
    )
    metrics = WorkerMetrics()
    metrics.install(app)
    app.state.metrics = metrics
    worker = processor or IdempotentSourceIngestProcessor()
    embeddings = embedding_provider or configured_provider()
    models = model_gateway or configured_gateway()

    @app.post("/internal/analysis/plan", include_in_schema=False)
    async def plan_computation(request: Request):
        if not _authorized(request, expected_token):
            return JSONResponse(status_code=401, content={"error": "Unauthorized"})
        try:
            from .analysis.contracts import PlanningRequest
            command = PlanningRequest.model_validate(await _request_json(request, limit=512 * 1024))
        except (ContractError, ValueError):
            return JSONResponse(status_code=400, content={"code": "AI_REQUEST_INVALID"})
        try:
            request.state.diagnostics["analysisId"] = str(command.analysis_id)
            result = await run_in_threadpool(metrics.ai_call, invoke, models, models.plan_computation, command)
            return result.model_dump(mode='json', by_alias=True)
        except ProviderError as error:
            return JSONResponse(status_code=503 if error.code == 'AI_UNAVAILABLE' else 422 if error.code == 'AI_REFUSED' else 502,
                                content=error_content(error))
        except Exception:
            return JSONResponse(status_code=502, content={"code": "AI_PROVIDER_ERROR"})

    @app.get("/internal/ai/model", include_in_schema=False)
    async def model_metadata(request: Request):
        if not _authorized(request, expected_token):
            return JSONResponse(status_code=401, content={"error": "Unauthorized"})
        try:
            return models.model_metadata().model_dump(by_alias=True)
        except ProviderError as failure:
            return JSONResponse(status_code=503 if failure.retryable else 502, content={"code": failure.code})
        except Exception:
            return JSONResponse(status_code=502, content={"code": "AI_PROVIDER_ERROR"})

    @app.post("/internal/ai/generate", include_in_schema=False)
    async def generate(request: Request):
        if not _authorized(request, expected_token):
            return JSONResponse(status_code=401, content={"error": "Unauthorized"})
        try:
            payload = await _request_json(request, limit=512 * 1024)
            command = (ContextualRequest if isinstance(payload, dict) and payload.get('schemaVersion') in {'2.0', '3.0'}
                else GenerationRequest).model_validate(payload)
        except (ContractError, ValueError):
            return JSONResponse(status_code=400, content={"code": "AI_REQUEST_INVALID"})
        try:
            result = await run_in_threadpool(metrics.ai_call, invoke, models, models.generate_structured, command)
            return result.model_dump(mode='json', by_alias=True)
        except ProviderError as error:
            return JSONResponse(status_code=503 if error.code == 'AI_UNAVAILABLE' else 422 if error.code == 'AI_REFUSED' else 502,
                                content=error_content(error))
        except Exception:
            # Do not log provider bodies, prompt/source text or credentials.
            return JSONResponse(status_code=502, content={"code": "AI_PROVIDER_ERROR"})

    @app.post("/internal/ai/author", include_in_schema=False)
    async def author(request: Request):
        if not _authorized(request, expected_token):
            return JSONResponse(status_code=401, content={"error": "Unauthorized"})
        try:
            payload = await _request_json(request, limit=512 * 1024)
            command = ContextualRequest.model_validate(payload)
            from .ai.authoring import instruction
            instruction(command)
        except (ContractError, ValueError, KeyError, TypeError):
            return JSONResponse(status_code=400, content={"code": "AI_REQUEST_INVALID"})
        try:
            result = await run_in_threadpool(metrics.ai_call, invoke, models, models.generate_authoring, command)
            return result.model_dump(mode='json', by_alias=True)
        except ProviderError as error:
            return JSONResponse(status_code=503 if error.code == 'AI_UNAVAILABLE' else 422 if error.code == 'AI_REFUSED' else 502,
                                content=error_content(error))
        except Exception:
            return JSONResponse(status_code=502, content={"code": "AI_PROVIDER_ERROR"})

    @app.post("/internal/ai/analyze", include_in_schema=False)
    async def analyze(request: Request):
        if not _authorized(request, expected_token):
            return JSONResponse(status_code=401, content={"error": "Unauthorized"})
        try:
            payload = await _request_json(request, limit=512 * 1024)
            command = ContextualRequest.model_validate(payload)
            from .ai.source_analysis import instruction
            instruction(command)
        except (ContractError, ValueError, KeyError, TypeError):
            return JSONResponse(status_code=400, content={"code": "AI_REQUEST_INVALID"})
        try:
            result = await run_in_threadpool(metrics.ai_call, invoke, models, models.generate_analysis, command)
            return result.model_dump(mode='json', by_alias=True)
        except ProviderError as error:
            return JSONResponse(status_code=503 if error.code == 'AI_UNAVAILABLE' else 422 if error.code == 'AI_REFUSED' else 502,
                                content=error_content(error))
        except Exception:
            return JSONResponse(status_code=502, content={"code": "AI_PROVIDER_ERROR"})

    @app.get("/internal/embeddings/model", include_in_schema=False)
    async def embedding_model(request: Request):
        if not _authorized(request, expected_token):
            return JSONResponse(status_code=401, content={"error": "Unauthorized"})
        return embeddings.model_metadata().model_dump(by_alias=True)

    @app.post("/internal/embeddings/{operation}", include_in_schema=False)
    async def embed(operation: str, request: Request):
        if not _authorized(request, expected_token):
            return JSONResponse(status_code=401, content={"error": "Unauthorized"})
        try:
            payload = await _request_json(request, limit=1024 * 1024)
            if not isinstance(payload, dict) or set(payload) != {'texts'} or not isinstance(payload['texts'], list) or not 1 <= len(payload['texts']) <= 32:
                raise ValueError('Invalid embedding request')
            if operation == 'documents':
                result = await run_in_threadpool(metrics.ai_call, embeddings.embed_documents, payload['texts'])
            elif operation == 'query' and len(payload['texts']) == 1:
                result = await run_in_threadpool(metrics.ai_call, embeddings.embed_query, payload['texts'][0])
            else:
                raise ValueError('Invalid embedding operation')
            return result.model_dump(by_alias=True)
        except (ContractError, ValueError):
            return JSONResponse(status_code=400, content={"error": "Invalid embedding request"})
        except EmbeddingError as error:
            return JSONResponse(status_code=503 if error.transient else 422, content={"error": "Embedding failed"})

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

    @app.get("/metrics", include_in_schema=False)
    async def export_metrics(request: Request):
        if not _authorized(request, expected_token):
            return JSONResponse(status_code=401, content={"error": "Unauthorized"})
        return metrics.export()

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
            request.state.diagnostics.update(jobId=str(command.job_id), sourceId=str(command.source_id), attempt=command.attempt)
            started = time.perf_counter()
            success = False
            duplicate = False
            try:
                LOGGER.info("Source ingestion started", extra={"event": "worker.source.started"})
                processed = await run_in_threadpool(worker.process, command)
                success = processed.result.status == "SUCCEEDED"
                duplicate = processed.duplicate
            finally:
                metrics.source_finished(started, success, duplicate)
            return JSONResponse(
                status_code=200,
                content=processed.result.model_dump(mode="json", by_alias=True),
            )
        except ContractError as invalid:
            return JSONResponse(status_code=400, content={"error": str(invalid)})
        except IdempotencyConflict as conflict:
            return JSONResponse(status_code=409, content={"error": str(conflict)})
        except Exception:
            LOGGER.error("Source ingestion failed", extra={"event": "worker.source.failed"})
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


async def _request_json(request: Request, limit: int = MAX_REQUEST_BYTES) -> Any:
    content_type = request.headers.get("Content-Type", "").partition(";")[0].strip().lower()
    if content_type != "application/json":
        raise ContractError("Content-Type must be application/json")

    raw_length = request.headers.get("Content-Length")
    try:
        declared_length = int(raw_length or "")
    except ValueError as invalid:
        raise ContractError("Content-Length is required") from invalid
    if declared_length < 1 or declared_length > limit:
        raise ContractError("Request body size is invalid")

    body = await request.body()
    if len(body) != declared_length or len(body) > limit:
        raise ContractError("Request body size is invalid")
    try:
        return json.loads(body)
    except (UnicodeDecodeError, json.JSONDecodeError) as invalid:
        raise ContractError("Request body must contain valid JSON") from invalid
