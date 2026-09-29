"""Idempotent local execution seam; extraction implementations are added behind this API."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from threading import Lock

from .contracts import SourceIngestCommand


class IdempotencyConflict(RuntimeError):
    """The same durable job id was reused for a different command."""


@dataclass(frozen=True, slots=True)
class ProcessResult:
    duplicate: bool


class IdempotentSourceIngestProcessor:
    """Executes a command once per process and makes HTTP redelivery harmless.

    PostgreSQL remains the durable source of truth. This small registry only protects a
    running worker from an ambiguous HTTP retry; future extraction writes must also use
    ``job_id`` as their database idempotency key.
    """

    def __init__(self, handler: Callable[[SourceIngestCommand], None] | None = None) -> None:
        self._handler = handler or (lambda _command: None)
        self._completed: dict[str, SourceIngestCommand] = {}
        self._lock = Lock()

    def process(self, command: SourceIngestCommand) -> ProcessResult:
        key = str(command.job_id)
        with self._lock:
            existing = self._completed.get(key)
            if existing is not None:
                if existing.operation_key() != command.operation_key():
                    raise IdempotencyConflict("job id was already used for a different command")
                return ProcessResult(duplicate=True)

            # Keep the critical section through execution. The local worker is deliberately
            # conservative: concurrent redelivery cannot acknowledge before the first call ends.
            self._handler(command)
            self._completed[key] = command
            return ProcessResult(duplicate=False)
