from __future__ import annotations

from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from researchhub_worker.processor import IdempotentSourceIngestProcessor
from researchhub_worker.server import create_app


@pytest.fixture
def client() -> TestClient:
    return TestClient(create_app())


def payload() -> dict[str, object]:
    return {
        "jobId": str(uuid4()),
        "workspaceId": str(uuid4()),
        "jobType": "SOURCE_INGEST",
        "resourceType": "SOURCE",
        "resourceId": str(uuid4()),
        "attempt": 1,
    }


def test_health_and_not_found(client: TestClient) -> None:
    health = client.get("/health")
    missing = client.get("/missing")

    assert health.status_code == 200
    assert health.json() == {"status": "UP"}
    assert health.headers["Cache-Control"] == "no-store"
    assert missing.status_code == 404
    assert missing.json() == {"error": "Not found"}


def test_accepts_and_deduplicates_a_command(client: TestClient) -> None:
    body = payload()
    first = client.post("/internal/jobs/source-ingest", json=body)
    second = client.post("/internal/jobs/source-ingest", json=body)

    assert first.status_code == 200
    assert first.json() == {"accepted": True, "duplicate": False}
    assert second.status_code == 200
    assert second.json() == {"accepted": True, "duplicate": True}
    assert first.headers["Cache-Control"] == "no-store"


def test_rejects_bad_media_type_json_and_body_size(client: TestClient) -> None:
    wrong_type = client.post(
        "/internal/jobs/source-ingest", content=b"{}", headers={"Content-Type": "text/plain"}
    )
    assert wrong_type.status_code == 400
    assert wrong_type.json() == {"error": "Content-Type must be application/json"}

    invalid_json = client.post(
        "/internal/jobs/source-ingest", content=b"not-json", headers={"Content-Type": "application/json"}
    )
    assert invalid_json.status_code == 400
    assert invalid_json.json() == {"error": "Request body must contain valid JSON"}

    oversized = client.post(
        "/internal/jobs/source-ingest",
        content=b"x" * (16 * 1024 + 1),
        headers={"Content-Type": "application/json"},
    )
    assert oversized.status_code == 400
    assert oversized.json() == {"error": "Request body size is invalid"}


def test_internal_failure_is_logged_but_not_returned() -> None:
    def explode(_command: object) -> None:
        raise RuntimeError("database password is secret")

    client = TestClient(create_app(IdempotentSourceIngestProcessor(explode)))
    response = client.post("/internal/jobs/source-ingest", json=payload())

    assert response.status_code == 500
    assert response.json() == {"error": "Processing failed"}
    assert "secret" not in response.text


def test_exposes_only_health_and_internal_job_routes() -> None:
    paths = {route.path for route in create_app().routes}

    assert paths == {"/health", "/internal/jobs/source-ingest"}
    assert all(not path.startswith("/api/") for path in paths)
