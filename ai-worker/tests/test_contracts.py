from uuid import uuid4

import pytest

from researchhub_worker.contracts import ContractError, SourceIngestCommand


def payload() -> dict[str, object]:
    return {
        "jobId": str(uuid4()),
        "workspaceId": str(uuid4()),
        "jobType": "SOURCE_INGEST",
        "resourceType": "SOURCE",
        "resourceId": str(uuid4()),
        "attempt": 1,
    }


def test_parses_the_explicit_source_ingest_contract() -> None:
    raw = payload()
    command = SourceIngestCommand.from_json(raw)

    assert str(command.job_id) == raw["jobId"]
    assert command.job_type == "SOURCE_INGEST"
    assert command.resource_type == "SOURCE"
    assert command.attempt == 1


@pytest.mark.parametrize(
    ("change", "message"),
    [
        ({"jobId": "bad"}, "jobId must be a UUID"),
        ({"workspaceId": 7}, "workspaceId must be a UUID"),
        ({"resourceId": "bad"}, "resourceId must be a UUID"),
        ({"jobType": "ANALYSIS_EXECUTION"}, "jobType must be SOURCE_INGEST"),
        ({"resourceType": "DOCUMENT"}, "resourceType must be SOURCE"),
        ({"attempt": 0}, "attempt must be an integer between 1 and 100"),
        ({"attempt": True}, "attempt must be an integer between 1 and 100"),
    ],
)
def test_rejects_invalid_fields(change: dict[str, object], message: str) -> None:
    raw = payload() | change
    with pytest.raises(ContractError, match=message):
        SourceIngestCommand.from_json(raw)


def test_rejects_missing_unknown_and_non_object_contracts() -> None:
    raw = payload()
    raw["authorization"] = "must-never-cross-the-boundary"
    with pytest.raises(ContractError, match="fields do not match"):
        SourceIngestCommand.from_json(raw)

    del raw["authorization"]
    del raw["resourceId"]
    with pytest.raises(ContractError, match="fields do not match"):
        SourceIngestCommand.from_json(raw)

    with pytest.raises(ContractError, match="JSON object"):
        SourceIngestCommand.from_json([])
