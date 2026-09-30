"""Idempotent local execution seam; extraction implementations are added behind this API."""

from __future__ import annotations

from collections import OrderedDict
from collections.abc import Callable
from dataclasses import dataclass
from threading import Lock

from .contracts import ContractError, SourceIngestCommand, SourceIngestResult
from .parsing import SourceParser


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
        self._handler = handler or SourceParser()
        self._completed: dict[str, tuple[SourceIngestCommand, SourceIngestResult]] = OrderedDict()
        self._lock = Lock()

    def process(self, command: SourceIngestCommand) -> ProcessResult:
        key = str(command.job_id)
        with self._lock:
            existing = self._completed.get(key)
            if existing is not None:
                existing_command, result = existing
                if existing_command.operation_key() != command.operation_key():
                    raise IdempotencyConflict("job id was already used for a different command")
                self._completed.move_to_end(key)
                return ProcessResult(result=result.as_duplicate(), duplicate=True)

            # Keep the critical section through execution so concurrent redelivery cannot
            # acknowledge before the first execution has produced a validated result.
            result = self._handler(command)
            if not isinstance(result, SourceIngestResult):
                raise ContractError("Processor did not return contract v4")
            result.validate_identity(command)
            self._completed[key] = (command, result)
            if len(self._completed) > 16:
                self._completed.popitem(last=False)
            return ProcessResult(result=result, duplicate=False)
