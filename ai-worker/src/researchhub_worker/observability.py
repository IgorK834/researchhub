"""Safe JSON diagnostics and bounded Prometheus metrics for the internal AI/data boundary."""
from __future__ import annotations

from contextvars import ContextVar
from datetime import datetime, timezone
import json
import logging
import re
import time
from uuid import uuid4

from fastapi import Request
from fastapi.responses import JSONResponse, Response
from prometheus_client import CollectorRegistry, Counter, Histogram, CONTENT_TYPE_LATEST, generate_latest

HEADER = "X-Request-ID"
CONTEXT: ContextVar[dict] = ContextVar("request_diagnostics", default={})
LOGGER = logging.getLogger(__name__)
FIELDS = frozenset({"requestId", "jobId", "sourceId", "analysisId", "attempt", "status", "route",
                    "outcome", "duplicate", "errorType", "durationMs"})


def request_id(value: str | None) -> str:
    return value if value and re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,63}", value, flags=re.ASCII) else str(uuid4())


class JsonFormatter(logging.Formatter):
    """Use an allowlist, never exception messages/tracebacks, arbitrary extras or argument bodies."""
    def format(self, record: logging.LogRecord) -> str:
        result = {"timestamp": datetime.now(timezone.utc).isoformat(), "level": record.levelname,
                  "logger": record.name, "event": getattr(record, "event", "runtime.log")}
        fields = CONTEXT.get() | {key: getattr(record, key) for key in FIELDS if hasattr(record, key)}
        result.update({key: value for key, value in fields.items() if key in FIELDS})
        return json.dumps(result, ensure_ascii=True)


def configure_logging(level: str) -> dict:
    config = {"version": 1, "disable_existing_loggers": False,
              "formatters": {"json": {"()": JsonFormatter}},
              "handlers": {"console": {"class": "logging.StreamHandler", "formatter": "json"}},
              "root": {"handlers": ["console"], "level": level.upper()},
              "loggers": {name: {"handlers": [], "propagate": True, "level": level.upper()}
                          for name in ("uvicorn", "uvicorn.error", "uvicorn.access")}}
    import logging.config
    logging.config.dictConfig(config)
    return config


class WorkerMetrics:
    def __init__(self) -> None:
        # Each process/app owns a registry; repeated test factories never accumulate collectors.
        self.registry = CollectorRegistry()
        self.http = Histogram("researchhub_worker_http_request_duration_seconds", "Worker HTTP latency",
                              ("route", "status"), registry=self.registry)
        self.source = Histogram("researchhub_worker_source_processing_duration_seconds", "Source attempt duration",
                                ("outcome",), registry=self.registry)
        self.ai = Histogram("researchhub_worker_ai_request_duration_seconds", "AI provider request duration",
                            ("outcome",), registry=self.registry)
        self.failures = Counter("researchhub_worker_failures_total", "Failed source processing attempts",
                                registry=self.registry)

    def install(self, app) -> None:
        @app.middleware("http")
        async def diagnostics(request: Request, call_next):
            values = request.headers.getlist(HEADER)
            id_ = request_id(values[0] if len(values) == 1 else None)
            fields = {"requestId": id_}
            request.state.diagnostics = fields
            token = CONTEXT.set(fields)
            started = time.perf_counter()
            try:
                try:
                    response = await call_next(request)
                except Exception as error:
                    # The framework's default exception path could print submitted/provider data.
                    LOGGER.error("Request failed", extra={"event": "worker.request.failed", "errorType": type(error).__name__})
                    response = JSONResponse(status_code=500, content={"error": "Request failed"})
                route = getattr(request.scope.get("route"), "path", "UNKNOWN")
                elapsed = time.perf_counter() - started
                self.http.labels(route, str(response.status_code)).observe(elapsed)
                LOGGER.info("Request completed", extra={"event": "worker.request.completed", "route": route,
                            "status": response.status_code, "durationMs": round(elapsed * 1000, 3)})
                response.headers[HEADER] = id_
                response.headers["Cache-Control"] = "no-store"
                return response
            finally:
                CONTEXT.reset(token)

    def export(self) -> Response:
        return Response(content=generate_latest(self.registry), headers={"Content-Type": CONTENT_TYPE_LATEST})

    def source_finished(self, started: float, success: bool, duplicate: bool) -> None:
        # Duplicate acknowledgements do not represent new processing attempts.
        if not duplicate:
            self.source.labels("success" if success else "failure").observe(time.perf_counter() - started)
            if not success:
                self.failures.inc()
        LOGGER.info("Source ingestion completed", extra={"event": "worker.source.completed",
                    "outcome": "success" if success else "failure", "duplicate": duplicate})

    def ai_call(self, call, *args):
        started = time.perf_counter()
        success = False
        try:
            result = call(*args)
            success = True
            return result
        finally:
            self.ai.labels("success" if success else "failure").observe(time.perf_counter() - started)
            LOGGER.info("AI request completed", extra={"event": "worker.ai.completed",
                        "outcome": "success" if success else "failure"})
