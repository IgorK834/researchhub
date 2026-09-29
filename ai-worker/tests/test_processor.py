from dataclasses import replace
from uuid import uuid4

import pytest

from researchhub_worker.contracts import SourceIngestCommand
from researchhub_worker.processor import IdempotencyConflict, IdempotentSourceIngestProcessor


def command() -> SourceIngestCommand:
    return SourceIngestCommand(uuid4(), uuid4(), "SOURCE_INGEST", "SOURCE", uuid4(), 1)


def test_redelivery_is_idempotent() -> None:
    calls: list[SourceIngestCommand] = []
    processor = IdempotentSourceIngestProcessor(calls.append)
    work = command()

    assert processor.process(work).duplicate is False
    assert processor.process(replace(work, attempt=2)).duplicate is True
    assert calls == [work]


def test_same_job_id_with_different_payload_is_a_conflict() -> None:
    processor = IdempotentSourceIngestProcessor()
    work = command()
    processor.process(work)

    with pytest.raises(IdempotencyConflict, match="different command"):
        processor.process(replace(work, resource_id=uuid4()))


def test_failed_work_can_be_retried() -> None:
    attempts = 0

    def fail_once(_command: SourceIngestCommand) -> None:
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            raise RuntimeError("private detail")

    processor = IdempotentSourceIngestProcessor(fail_once)
    work = command()
    with pytest.raises(RuntimeError, match="private detail"):
        processor.process(work)

    assert processor.process(work).duplicate is False
    assert attempts == 2
