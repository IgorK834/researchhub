"""Authenticated internal processing boundary for ResearchHub."""

from .contracts import SourceIngestCommand, SourceIngestResult
from .processor import IdempotentSourceIngestProcessor, ProcessResult

__all__ = ["IdempotentSourceIngestProcessor", "ProcessResult", "SourceIngestCommand", "SourceIngestResult"]
