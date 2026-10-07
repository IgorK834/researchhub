from __future__ import annotations
import json
import logging
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from researchhub_worker.observability import CONTEXT, JsonFormatter, WorkerMetrics, request_id
from researchhub_worker.server import create_app
from researchhub_worker.contracts import SourceIngestResult
from researchhub_worker.processor import IdempotentSourceIngestProcessor
from uuid import UUID

TOKEN = "test-worker-metrics-token-at-least-32-characters"
AUTH = {"Authorization": f"Bearer {TOKEN}"}
FIXTURES = Path(__file__).resolve().parents[2] / "contracts" / "processing" / "v4"

@pytest.mark.parametrize("value", [None, "", "a\nb", "Bearer secret", "x" * 65, "ąć"])
def test_invalid_correlation_is_replaced(value):
    UUID(request_id(value))
    assert request_id("trace-123._") == "trace-123._"


def test_json_logging_cannot_serialize_sensitive_messages_exceptions_or_extras():
    token = CONTEXT.set({"requestId": "safe", "sourceId": "source", "password": "secret"})
    try:
        record = logging.LogRecord("worker", logging.ERROR, "", 0, "Bearer private %s", ("whole prompt",),
                                   (RuntimeError, RuntimeError("password=private"), None))
        record.event = "worker.source.failed"
        record.api_key = "secret"
        formatted = JsonFormatter().format(record)
        assert json.loads(formatted)["requestId"] == "safe"
        assert all(word not in formatted for word in ["private", "password", "prompt", "secret", "Bearer"])
    finally:
        CONTEXT.reset(token)


def test_source_correlation_reaches_threadpool_and_safe_logs_with_no_duplicate_metrics(caplog):
    seen = []
    def handler(command):
        seen.append(CONTEXT.get().copy())
        return SourceIngestResult.empty_success(command)
    app = create_app(IdempotentSourceIngestProcessor(handler), service_token=TOKEN)
    client = TestClient(app)
    payload = json.loads((FIXTURES / "source-ingest-request.json").read_text())
    caplog.set_level(logging.INFO, logger="researchhub_worker.observability")
    headers = AUTH | {"X-Request-ID": "ingest-request"}
    first = client.post("/internal/jobs/source-ingest", json=payload, headers=headers)
    second = client.post("/internal/jobs/source-ingest", json=payload, headers=headers)
    assert first.status_code == second.status_code == 200
    assert first.headers["X-Request-ID"] == "ingest-request"
    assert seen == [{"requestId": "ingest-request", "jobId": payload["jobId"], "sourceId": payload["sourceId"], "attempt": 1}]
    assert CONTEXT.get() == {}
    assert client.get("/metrics").status_code == 401
    assert client.get("/metrics", headers={"Authorization": "Bearer wrong"}).status_code == 401
    exported = client.get("/metrics", headers=AUTH)
    assert exported.status_code == 200
    assert exported.headers["Cache-Control"] == "no-store"
    assert 'researchhub_worker_source_processing_duration_seconds_count{outcome="success"} 1.0' in exported.text
    assert payload["jobId"] not in exported.text and TOKEN not in exported.text
    assert any(getattr(record, "event", None) == "worker.source.completed" for record in caplog.records)
    assert second.json()["duplicateDelivery"] is True


def test_failures_are_counted_without_leaking_exception_data():
    def handler(command):
        raise RuntimeError("password=secret signed-url source contents")
    app = create_app(IdempotentSourceIngestProcessor(handler), service_token=TOKEN)
    client = TestClient(app)
    payload = json.loads((FIXTURES / "source-ingest-request.json").read_text())
    assert client.post("/internal/jobs/source-ingest", json=payload, headers=AUTH).status_code == 500
    exported = client.get("/metrics", headers=AUTH).text
    assert "researchhub_worker_failures_total 1.0" in exported
    assert 'outcome="failure"' in exported
    assert "secret" not in exported
    assert client.get("/unknown?token=secret", headers={"X-Request-ID": "a b"}).status_code == 404


def test_unexpected_middleware_failures_are_safe_and_http_route_labels_are_bounded():
    app = FastAPI()
    metrics = WorkerMetrics()
    metrics.install(app)
    @app.get("/fail")
    def fail():
        raise RuntimeError("Bearer secret")
    client = TestClient(app)
    response = client.get("/fail")
    assert response.status_code == 500
    assert response.json() == {"error": "Request failed"}
    UUID(response.headers["X-Request-ID"])
    for index in range(10):
        client.get(f"/unknown/{index}", headers=[("X-Request-ID", "one"), ("X-Request-ID", "two")])
    exported = metrics.export().body.decode()
    assert 'route="UNKNOWN"' in exported
    assert "unknown/" not in exported


def test_ai_success_failure_duration_and_concurrent_request_isolation():
    metrics = WorkerMetrics()
    assert metrics.ai_call(lambda: "ok") == "ok"
    with pytest.raises(ValueError):
        metrics.ai_call(lambda: (_ for _ in ()).throw(ValueError("secret")))
    exported = metrics.export().body.decode()
    assert 'researchhub_worker_ai_request_duration_seconds_count{outcome="success"} 1.0' in exported
    assert 'researchhub_worker_ai_request_duration_seconds_count{outcome="failure"} 1.0' in exported
    app = FastAPI()
    metrics.install(app)
    @app.get("/identity")
    def identity():
        return CONTEXT.get()
    client = TestClient(app)
    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(lambda index: client.get("/identity", headers={"X-Request-ID": str(index)}).json(), range(16)))
    assert [result["requestId"] for result in results] == list(map(str, range(16)))
