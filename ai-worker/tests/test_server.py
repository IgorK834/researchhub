from __future__ import annotations

import http.client
import json
from threading import Thread
from typing import Iterator
from uuid import uuid4

import pytest

from researchhub_worker.processor import IdempotentSourceIngestProcessor
from researchhub_worker.server import create_server


@pytest.fixture
def worker_server() -> Iterator[tuple[str, int]]:
    server = create_server("127.0.0.1", 0)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        host, port = server.server_address
        yield str(host), int(port)
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


def payload() -> dict[str, object]:
    return {
        "jobId": str(uuid4()),
        "workspaceId": str(uuid4()),
        "jobType": "SOURCE_INGEST",
        "resourceType": "SOURCE",
        "resourceId": str(uuid4()),
        "attempt": 1,
    }


def request(
    address: tuple[str, int], method: str, path: str, body: bytes = b"", content_type: str = "application/json"
) -> tuple[int, dict[str, object], dict[str, str]]:
    connection = http.client.HTTPConnection(*address, timeout=2)
    connection.request(method, path, body=body, headers={"Content-Type": content_type})
    response = connection.getresponse()
    response_body = json.loads(response.read())
    headers = {name: value for name, value in response.getheaders()}
    connection.close()
    return response.status, response_body, headers


def test_health_and_not_found(worker_server: tuple[str, int]) -> None:
    assert request(worker_server, "GET", "/healthz")[:2] == (200, {"status": "UP"})
    assert request(worker_server, "GET", "/missing")[:2] == (404, {"error": "Not found"})
    assert request(worker_server, "POST", "/missing")[:2] == (404, {"error": "Not found"})


def test_accepts_and_deduplicates_a_command(worker_server: tuple[str, int]) -> None:
    body = json.dumps(payload()).encode()
    first = request(worker_server, "POST", "/internal/jobs/source-ingest", body)
    second = request(worker_server, "POST", "/internal/jobs/source-ingest", body)

    assert first[:2] == (200, {"accepted": True, "duplicate": False})
    assert second[:2] == (200, {"accepted": True, "duplicate": True})
    assert first[2]["Cache-Control"] == "no-store"


def test_rejects_bad_media_type_and_json(worker_server: tuple[str, int]) -> None:
    status, response, _ = request(
        worker_server, "POST", "/internal/jobs/source-ingest", b"{}", "text/plain"
    )
    assert status == 400
    assert response == {"error": "Content-Type must be application/json"}

    status, response, _ = request(
        worker_server, "POST", "/internal/jobs/source-ingest", b"not-json"
    )
    assert status == 400
    assert response == {"error": "Request body must contain valid JSON"}


def test_internal_failure_is_logged_but_not_returned() -> None:
    def explode(_command: object) -> None:
        raise RuntimeError("database password is secret")

    server = create_server("127.0.0.1", 0, IdempotentSourceIngestProcessor(explode))
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        body = json.dumps(payload()).encode()
        status, response, _ = request(server.server_address, "POST", "/internal/jobs/source-ingest", body)
        assert status == 500
        assert response == {"error": "Processing failed"}
        assert "secret" not in json.dumps(response)
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)
