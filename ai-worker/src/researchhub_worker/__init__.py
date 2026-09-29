"""Internal, token-free processing boundary for ResearchHub."""

from .contracts import SourceIngestCommand
from .processor import IdempotentSourceIngestProcessor, ProcessResult

__all__ = ["IdempotentSourceIngestProcessor", "ProcessResult", "SourceIngestCommand"]
