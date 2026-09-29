"""Idempotent local execution seam; extraction implementations are added behind this API."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from threading import Lock

from .contracts import ContractError, SourceIngestCommand, SourceIngestResult


class IdempotencyConflict(RuntimeError):
    """The same durable job id was reused for a different command."""


@dataclass(frozen=True, slots=True)
class ProcessResult:
    result: SourceIngestResult
    duplicate: bool


class IdempotentSourceIngestProcessor:
    """Executes a command once per process and makes HTTP redelivery harmless."""

    def __init__(
        self,
        handler: Callable[[SourceIngestCommand], SourceIngestResult] | None = None,
    ) -> None:
        self._handler = handler or SourceIngestResult.empty_success
        self._completed: dict[str, tuple[SourceIngestCommand, SourceIngestResult]] = {}
        self._lock = Lock()

    def process(self, command: SourceIngestCommand) -> ProcessResult:
        key = str(command.job_id)
        with self._lock:
            existing = self._completed.get(key)
            if existing is not None:
                existing_command, result = existing
                if existing_command.operation_key() != command.operation_key():
                    raise IdempotencyConflict("job id was already used for a different command")
                return ProcessResult(result=result.as_duplicate(), duplicate=True)

            # Keep the critical section through execution so concurrent redelivery cannot
            # acknowledge before the first execution has produced a validated result.
            result = self._handler(command)
            if not isinstance(result, SourceIngestResult):
                raise ContractError("Processor did not return contract v1")
            result.validate_identity(command)
            self._completed[key] = (command, result)
            return ProcessResult(result=result, duplicate=False)
