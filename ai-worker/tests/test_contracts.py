import json
from pathlib import Path
from uuid import uuid4

import pytest
from pydantic import ValidationError

from researchhub_worker.contracts import (
    ContractError,
    SourceIngestCommand,
    SourceIngestResult,
    parse_source_ingest,
)

FIXTURES = Path(__file__).resolve().parents[2] / "contracts" / "processing" / "v1"


def fixture(name: str) -> dict[str, object]:
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


def test_parses_and_round_trips_the_shared_request_fixture() -> None:
    raw = fixture("source-ingest-request.json")

    command = parse_source_ingest(raw)

    assert str(command.job_id) == raw["jobId"]
    assert command.source_type == "PDF"
    assert command.file_access.kind == "SIGNED_URL"
    assert command.requested_processing_version == "source-ingest-1"
    assert command.model_dump(mode="json", by_alias=True) == raw


@pytest.mark.parametrize(
    "change",
    [
        {"schemaVersion": "2.0"},
        {"jobId": "bad"},
        {"workspaceId": 7},
        {"sourceId": "bad"},
        {"sourceType": "EXECUTABLE"},
        {"requestedProcessingVersion": "latest"},
        {"attempt": 0},
        {"attempt": True},
    ],
)
def test_rejects_invalid_request_fields_without_echoing_values(change: dict[str, object]) -> None:
    raw = fixture("source-ingest-request.json") | change

    with pytest.raises(ContractError, match="contract v1") as failure:
        parse_source_ingest(raw)

    assert "bad" not in str(failure.value)
    assert "latest" not in str(failure.value)


def test_rejects_missing_unknown_and_unsafe_file_access() -> None:
    unknown = fixture("source-ingest-request.json") | {"authorization": "must-not-cross"}
    with pytest.raises(ContractError, match="contract v1"):
        parse_source_ingest(unknown)

    missing = fixture("source-ingest-request.json")
    del missing["sourceId"]
    with pytest.raises(ContractError, match="contract v1"):
        parse_source_ingest(missing)

    unsafe = fixture("source-ingest-request.json")
    unsafe["fileAccess"] = {
        "kind": "LOCAL_PATH",
        "url": "file:///private/input.pdf",
        "expiresAt": "2030-01-02T03:04:05",
    }
    with pytest.raises(ContractError, match="contract v1"):
        parse_source_ingest(unsafe)


def test_parses_shared_success_and_failure_result_fixtures() -> None:
    success = SourceIngestResult.model_validate(fixture("source-ingest-result-success.json"))
    failed = SourceIngestResult.model_validate(fixture("source-ingest-result-failure.json"))

    assert success.status == "SUCCEEDED"
    assert success.extraction_metadata is not None
    assert len(success.structure.pages) == 1
    assert len(success.structure.sections) == 1
    assert len(success.chunks) == 1
    assert failed.status == "FAILED"
    assert failed.failure is not None
    assert failed.failure.code == "DOCUMENT_PARSE_FAILED"


def test_result_status_ranges_and_identity_are_validated() -> None:
    command = SourceIngestCommand.model_validate(fixture("source-ingest-request.json"))
    success = SourceIngestResult.model_validate(fixture("source-ingest-result-success.json"))
    success.validate_identity(command)

    with pytest.raises(ContractError, match="identity"):
        success.model_copy(update={"workspace_id": uuid4()}).validate_identity(command)

    invalid_status = fixture("source-ingest-result-success.json")
    invalid_status["failure"] = {"code": "FAILED", "message": "safe"}
    with pytest.raises(ValidationError, match="successful result"):
        SourceIngestResult.model_validate(invalid_status)

    reversed_page = fixture("source-ingest-result-success.json")
    reversed_page["structure"]["pages"][0]["characterStart"] = 29  # type: ignore[index]
    with pytest.raises(ValidationError, match="range is reversed"):
        SourceIngestResult.model_validate(reversed_page)
