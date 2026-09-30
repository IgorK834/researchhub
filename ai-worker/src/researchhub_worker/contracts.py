"""Versioned, strict contracts at the Spring/Python processing boundary."""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import (
    AnyHttpUrl,
    BaseModel,
    ConfigDict,
    Field,
    StrictInt,
    StringConstraints,
    ValidationError,
    model_validator,
)

SCHEMA_VERSION = "2.0"
PROCESSING_VERSION = "source-ingest-2"
MAX_PAGES = 10_000
MAX_SECTIONS = 50_000
MAX_CHUNKS = 100_000
MAX_WARNINGS = 100

ShortText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=500)]
Identifier = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=128)]
FailureCode = Annotated[str, StringConstraints(pattern=r"^[A-Z][A-Z0-9_]{0,63}$")]


def _camel_case(value: str) -> str:
    first, *rest = value.split("_")
    return first + "".join(word.capitalize() for word in rest)


class ContractError(ValueError):
    """A safe validation failure that never echoes submitted values."""


class ContractModel(BaseModel):
    """No unknown fields and stable camelCase JSON on every boundary model."""

    model_config = ConfigDict(
        alias_generator=lambda name: _camel_case(name),
        populate_by_name=True,
        extra="forbid",
        frozen=True,
    )


class TemporaryFileAccess(ContractModel):
    kind: Literal["SIGNED_URL"]
    url: AnyHttpUrl
    expires_at: datetime

    @model_validator(mode="after")
    def require_timezone(self) -> TemporaryFileAccess:
        if self.expires_at.tzinfo is None or self.expires_at.utcoffset() is None:
            raise ValueError("expiresAt must include a timezone")
        return self


class SourceIngestCommand(ContractModel):
    schema_version: Literal[SCHEMA_VERSION]
    job_id: UUID
    workspace_id: UUID
    source_id: UUID
    source_type: Literal["PDF", "DOCX", "XLSX", "CSV", "TXT"]
    file_access: TemporaryFileAccess
    requested_processing_version: Literal[PROCESSING_VERSION]
    attempt: Annotated[StrictInt, Field(ge=1, le=100)]

    def operation_key(self) -> tuple[UUID, UUID, str, str]:
        """Immutable target identity; delivery attempt and a renewed URL may change."""
        return (
            self.workspace_id,
            self.source_id,
            self.source_type,
            self.requested_processing_version,
        )


class ExtractionMetadata(ContractModel):
    title: Annotated[str, StringConstraints(max_length=500)] | None = None
    author: Annotated[str, StringConstraints(max_length=500)] | None = None
    language: Annotated[str, StringConstraints(max_length=32)] | None = None
    page_count: Annotated[int, Field(ge=0)]
    character_count: Annotated[int, Field(ge=0)]
    content_sha256: Annotated[str, StringConstraints(pattern=r"^[0-9a-f]{64}$")] | None = None


class PageStructure(ContractModel):
    page_number: Annotated[int, Field(ge=1)]
    character_start: Annotated[int, Field(ge=0)]
    character_end: Annotated[int, Field(ge=0)]

    @model_validator(mode="after")
    def valid_range(self) -> PageStructure:
        if self.character_end < self.character_start:
            raise ValueError("page character range is reversed")
        return self


class SectionStructure(ContractModel):
    section_id: Identifier
    heading: Annotated[str, StringConstraints(max_length=500)] | None = None
    level: Annotated[int, Field(ge=1, le=20)]
    parent_section_id: Identifier | None = None
    character_start: Annotated[int, Field(ge=0)]
    character_end: Annotated[int, Field(ge=0)]

    @model_validator(mode="after")
    def valid_range(self) -> SectionStructure:
        if self.character_end < self.character_start:
            raise ValueError("section character range is reversed")
        return self


class DocumentStructure(ContractModel):
    pages: Annotated[list[PageStructure], Field(max_length=MAX_PAGES)]
    sections: Annotated[list[SectionStructure], Field(max_length=MAX_SECTIONS)]


class UnitLocation(ContractModel):
    kind: Literal["PDF_PAGE", "PARAGRAPH", "HEADING", "TABLE", "SHEET", "TEXT"]
    block_index: Annotated[int, Field(ge=0)] | None = None
    heading_level: Annotated[int, Field(ge=1, le=20)] | None = None
    sheet_name: Annotated[str, StringConstraints(max_length=128)] | None = None
    cell_range: Annotated[str, StringConstraints(max_length=64)] | None = None


class ColumnSample(ContractModel):
    column_number: Annotated[int, Field(ge=1, le=16384)]
    values: Annotated[list[Annotated[str, StringConstraints(max_length=500)]], Field(max_length=100)]
    data_types: Annotated[list[str], Field(max_length=10)]


class SheetMetadata(ContractModel):
    name: Annotated[str, StringConstraints(min_length=1, max_length=128)]
    state: Literal["visible", "hidden", "veryHidden"]
    used_range: Annotated[str, StringConstraints(max_length=64)] | None
    row_count_estimate: Annotated[int, Field(ge=0, le=1048576)] | None
    column_count: Annotated[int, Field(ge=0, le=16384)] | None
    header_candidate: Annotated[list[Annotated[str, StringConstraints(max_length=500)]], Field(max_length=256)]
    header_row: Annotated[int, Field(ge=1)] | None
    columns: Annotated[list[ColumnSample], Field(max_length=256)]
    sampled_rows: Annotated[int, Field(ge=0)]
    truncated: bool
    formula_presence: bool | None
    formula_scan_complete: bool


class WorkbookMetadata(ContractModel):
    sheets: Annotated[list[SheetMetadata], Field(max_length=100)]
    row_limit: Annotated[int, Field(ge=1, le=10000)]
    column_limit: Annotated[int, Field(ge=1, le=256)]
    sample_limit: Annotated[int, Field(ge=1, le=100)]


class ExtractedChunk(ContractModel):
    source_id: UUID
    parser_version: Identifier
    location: UnitLocation | None = None
    chunk_id: Identifier
    ordinal: Annotated[int, Field(ge=0)]
    text: Annotated[str, StringConstraints(max_length=250_000)]
    page_number: Annotated[int, Field(ge=1)] | None = None
    section_id: Identifier | None = None
    character_start: Annotated[int, Field(ge=0)]
    character_end: Annotated[int, Field(ge=0)]

    @model_validator(mode="after")
    def valid_range(self) -> ExtractedChunk:
        if self.character_end < self.character_start:
            raise ValueError("chunk character range is reversed")
        return self


class ProcessingFailure(ContractModel):
    code: FailureCode
    message: ShortText


class SourceIngestResult(ContractModel):
    schema_version: Literal[SCHEMA_VERSION]
    job_id: UUID
    workspace_id: UUID
    source_id: UUID
    processing_version: Literal[PROCESSING_VERSION]
    status: Literal["SUCCEEDED", "FAILED"]
    duplicate_delivery: bool = False
    parser_version: Identifier | None = None
    workbook: WorkbookMetadata | None = None
    extraction_metadata: ExtractionMetadata | None
    structure: DocumentStructure
    chunks: Annotated[list[ExtractedChunk], Field(max_length=MAX_CHUNKS)]
    warnings: Annotated[list[ShortText], Field(max_length=MAX_WARNINGS)]
    failure: ProcessingFailure | None

    @model_validator(mode="after")
    def consistent_status(self) -> SourceIngestResult:
        if self.status == "SUCCEEDED" and (self.failure is not None or self.extraction_metadata is None):
            raise ValueError("a successful result needs metadata and no failure")
        if self.status == "FAILED" and self.failure is None:
            raise ValueError("a failed result needs a failure")
        return self

    def validate_identity(self, command: SourceIngestCommand) -> None:
        if (
            self.job_id != command.job_id
            or self.workspace_id != command.workspace_id
            or self.source_id != command.source_id
            or self.processing_version != command.requested_processing_version
        ):
            raise ContractError("Worker result identity does not match the request")

    @classmethod
    def empty_success(cls, command: SourceIngestCommand) -> SourceIngestResult:
        return cls(
            schema_version=SCHEMA_VERSION,
            job_id=command.job_id,
            workspace_id=command.workspace_id,
            source_id=command.source_id,
            processing_version=command.requested_processing_version,
            status="SUCCEEDED",
            extraction_metadata=ExtractionMetadata(page_count=0, character_count=0),
            structure=DocumentStructure(pages=[], sections=[]),
            chunks=[],
            warnings=[],
            failure=None,
        )

    def as_duplicate(self) -> SourceIngestResult:
        return self.model_copy(update={"duplicate_delivery": True})


def parse_source_ingest(value: object) -> SourceIngestCommand:
    """Parse untrusted JSON while exposing only a stable, value-free error."""
    try:
        return SourceIngestCommand.model_validate(value)
    except ValidationError as invalid:
        raise ContractError("Request does not match source-ingest contract v2") from invalid
