import json
from pathlib import Path
from uuid import uuid4

import pytest

from researchhub_worker.contracts import ContractError, SourceIngestCommand, SourceIngestResult
from researchhub_worker.processor import IdempotencyConflict, IdempotentSourceIngestProcessor

FIXTURES = Path(__file__).resolve().parents[2] / "contracts" / "processing" / "v2"


def command() -> SourceIngestCommand:
    raw = json.loads((FIXTURES / "source-ingest-request.json").read_text(encoding="utf-8"))
    raw["jobId"] = str(uuid4())
    return SourceIngestCommand.model_validate(raw)


def test_redelivery_is_idempotent_even_with_a_renewed_url() -> None:
    calls: list[SourceIngestCommand] = []

    def handle(work: SourceIngestCommand) -> SourceIngestResult:
        calls.append(work)
        return SourceIngestResult.empty_success(work)

    processor = IdempotentSourceIngestProcessor(handle)
    work = command()
    retry = work.model_copy(
        update={
            "attempt": 2,
            "file_access": work.file_access.model_copy(
                update={"url": "https://storage.example/renewed?sig=new"}
            ),
        }
    )

    assert processor.process(work).duplicate is False
    duplicate = processor.process(retry)
    assert duplicate.duplicate is True
    assert duplicate.result.duplicate_delivery is True
    assert calls == [work]


def test_same_job_id_with_different_identity_is_a_conflict() -> None:
    processor = IdempotentSourceIngestProcessor(SourceIngestResult.empty_success)
    work = command()
    processor.process(work)

    with pytest.raises(IdempotencyConflict, match="different command"):
        processor.process(work.model_copy(update={"source_id": uuid4()}))


def test_failed_work_can_be_retried() -> None:
    attempts = 0

    def fail_once(work: SourceIngestCommand) -> SourceIngestResult:
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            raise RuntimeError("private detail")
        return SourceIngestResult.empty_success(work)

    processor = IdempotentSourceIngestProcessor(fail_once)
    work = command()
    with pytest.raises(RuntimeError, match="private detail"):
        processor.process(work)

    assert processor.process(work).duplicate is False
    assert attempts == 2


def test_worker_cannot_return_a_different_identity_or_non_contract_result() -> None:
    work = command()
    mismatched = SourceIngestResult.empty_success(work).model_copy(update={"source_id": uuid4()})
    with pytest.raises(ContractError, match="identity"):
        IdempotentSourceIngestProcessor(lambda _work: mismatched).process(work)

    with pytest.raises(ContractError, match="contract v2"):
        IdempotentSourceIngestProcessor(lambda _work: None).process(work)  # type: ignore[arg-type,return-value]
