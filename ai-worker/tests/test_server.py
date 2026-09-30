from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from researchhub_worker.contracts import SourceIngestResult
from researchhub_worker.processor import IdempotentSourceIngestProcessor
from researchhub_worker.server import create_app

SERVICE_TOKEN = "unit-test-service-token-at-least-32-characters"
AUTHORIZATION = {"Authorization": f"Bearer {SERVICE_TOKEN}"}
FIXTURES = Path(__file__).resolve().parents[2] / "contracts" / "processing" / "v2"


@pytest.fixture
def client() -> TestClient:
    return TestClient(create_app(IdempotentSourceIngestProcessor(SourceIngestResult.empty_success), service_token=SERVICE_TOKEN))


def payload() -> dict[str, object]:
    return json.loads((FIXTURES / "source-ingest-request.json").read_text(encoding="utf-8"))


def test_health_is_public_but_execution_requires_valid_service_identity(client: TestClient) -> None:
    health = client.get("/health")
    missing = client.post("/internal/jobs/source-ingest", json=payload())
    invalid = client.post(
        "/internal/jobs/source-ingest",
        json=payload(),
        headers={"Authorization": "Bearer definitely-not-the-service-token"},
    )

    assert health.status_code == 200
    assert health.json() == {"status": "UP"}
    assert missing.status_code == 401
    assert invalid.status_code == 401
    assert invalid.json() == {"error": "Unauthorized"}
    assert invalid.headers["WWW-Authenticate"] == "Bearer"
    assert SERVICE_TOKEN not in invalid.text


def test_accepts_and_deduplicates_a_contract_command(client: TestClient) -> None:
    body = payload()
    first = client.post("/internal/jobs/source-ingest", json=body, headers=AUTHORIZATION)
    second = client.post("/internal/jobs/source-ingest", json=body, headers=AUTHORIZATION)

    assert first.status_code == 200
    assert first.json()["status"] == "SUCCEEDED"
    assert first.json()["duplicateDelivery"] is False
    assert first.json()["extractionMetadata"] == {
        "title": None,
        "author": None,
        "language": None,
        "pageCount": 0,
        "characterCount": 0,
        "contentSha256": None,
    }
    assert second.status_code == 200
    assert second.json()["duplicateDelivery"] is True
    assert first.headers["Cache-Control"] == "no-store"


def test_rejects_bad_media_type_json_contract_and_body_size(client: TestClient) -> None:
    headers = AUTHORIZATION | {"Content-Type": "text/plain"}
    wrong_type = client.post("/internal/jobs/source-ingest", content=b"{}", headers=headers)
    assert wrong_type.status_code == 400
    assert wrong_type.json() == {"error": "Content-Type must be application/json"}

    headers = AUTHORIZATION | {"Content-Type": "application/json"}
    invalid_json = client.post("/internal/jobs/source-ingest", content=b"not-json", headers=headers)
    assert invalid_json.status_code == 400
    assert invalid_json.json() == {"error": "Request body must contain valid JSON"}

    invalid_contract = client.post(
        "/internal/jobs/source-ingest", json=payload() | {"browserToken": "private"}, headers=AUTHORIZATION
    )
    assert invalid_contract.status_code == 400
    assert invalid_contract.json() == {"error": "Request does not match source-ingest contract v2"}
    assert "private" not in invalid_contract.text

    oversized = client.post(
        "/internal/jobs/source-ingest",
        content=b"x" * (16 * 1024 + 1),
        headers=headers,
    )
    assert oversized.status_code == 400
    assert oversized.json() == {"error": "Request body size is invalid"}


def test_internal_failure_is_logged_but_not_returned() -> None:
    def explode(_command: object) -> SourceIngestResult:
        raise RuntimeError("database password is secret")

    client = TestClient(
        create_app(IdempotentSourceIngestProcessor(explode), service_token=SERVICE_TOKEN)  # type: ignore[arg-type]
    )
    response = client.post("/internal/jobs/source-ingest", json=payload(), headers=AUTHORIZATION)

    assert response.status_code == 500
    assert response.json() == {"error": "Processing failed"}
    assert "secret" not in response.text


def test_app_refuses_to_start_without_a_strong_service_token(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("AI_WORKER_SERVICE_TOKEN", raising=False)
    with pytest.raises(RuntimeError, match="at least 32"):
        create_app()
    with pytest.raises(RuntimeError, match="at least 32"):
        create_app(service_token=" too-short ")


def test_exposes_only_health_and_internal_job_routes() -> None:
    paths = {route.path for route in create_app(service_token=SERVICE_TOKEN).routes}

    assert paths == {"/health", "/internal/jobs/source-ingest"}
    assert all(not path.startswith("/api/") for path in paths)
