"""Strict JSON contracts shared at the Spring/Python boundary."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any
from uuid import UUID


class ContractError(ValueError):
    """A safe request validation failure."""


@dataclass(frozen=True, slots=True)
class SourceIngestCommand:
    job_id: UUID
    workspace_id: UUID
    job_type: str
    resource_type: str
    resource_id: UUID
    attempt: int

    _FIELDS = frozenset(
        {"jobId", "workspaceId", "jobType", "resourceType", "resourceId", "attempt"}
    )

    def operation_key(self) -> tuple[UUID, str, str, UUID]:
        """Immutable target identity; attempt is delivery metadata and may increase on retry."""
        return self.workspace_id, self.job_type, self.resource_type, self.resource_id

    @classmethod
    def from_json(cls, value: Any) -> SourceIngestCommand:
        if not isinstance(value, dict):
            raise ContractError("Request body must be a JSON object")
        unknown = set(value) - cls._FIELDS
        missing = cls._FIELDS - set(value)
        if unknown or missing:
            raise ContractError("Request fields do not match the source-ingest contract")

        job_id = _uuid(value["jobId"], "jobId")
        workspace_id = _uuid(value["workspaceId"], "workspaceId")
        resource_id = _uuid(value["resourceId"], "resourceId")
        if value["jobType"] != "SOURCE_INGEST":
            raise ContractError("jobType must be SOURCE_INGEST")
        if value["resourceType"] != "SOURCE":
            raise ContractError("resourceType must be SOURCE")
        attempt = value["attempt"]
        if isinstance(attempt, bool) or not isinstance(attempt, int) or not 1 <= attempt <= 100:
            raise ContractError("attempt must be an integer between 1 and 100")
        return cls(job_id, workspace_id, value["jobType"], value["resourceType"], resource_id, attempt)


def _uuid(value: Any, field: str) -> UUID:
    if not isinstance(value, str):
        raise ContractError(f"{field} must be a UUID")
    try:
        return UUID(value)
    except ValueError as invalid:
        raise ContractError(f"{field} must be a UUID") from invalid
