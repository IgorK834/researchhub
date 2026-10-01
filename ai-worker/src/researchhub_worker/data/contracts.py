"""Dataset-preview v1: the explicit contract between the Spring API, the browser and an analysis planner.

Mirrors ``DatasetPreview`` in the Spring ``analysis`` module. The JSON schema generated from these models is committed
in ``contracts/analysis/dataset-preview/v1`` and checked for drift by the tests. Every value is an inert string.
"""

import unicodedata
from typing import Annotated, Literal
from uuid import UUID

from pydantic import AfterValidator, Field, StringConstraints

from ..contract_model import ContractModel

MAX_RESPONSE_BYTES = 65536
MAX_SHEETS = 10
MAX_COLUMNS = 100
MAX_SAMPLE_ROWS = 10
MAX_CELLS = 300
MAX_CELL_BYTES = 96


def _inert_text(value: str) -> str:
    """At most 96 UTF-8 bytes and no control characters, which JSON would expand and defeat the byte budget."""
    if len(value.encode('utf-8', errors='replace')) > MAX_CELL_BYTES:
        raise ValueError('preview text is longer than 96 UTF-8 bytes')
    if any(unicodedata.category(character) == 'Cc' for character in value):
        raise ValueError('preview text contains control characters')
    return value


SafeText = Annotated[str, StringConstraints(max_length=MAX_CELL_BYTES), AfterValidator(_inert_text)]

WarningCode = Literal['SHEETS_OMITTED', 'ROWS_TRUNCATED', 'COLUMNS_TRUNCATED', 'ROW_COUNT_ESTIMATED',
                      'MISSING_VALUES_PARTIAL', 'VALUES_SHORTENED', 'FORMULAS_NOT_EVALUATED', 'TYPES_INFERRED',
                      'RESPONSE_SIZE_CAPPED']
TRUNCATION_CODES = frozenset({'SHEETS_OMITTED', 'ROWS_TRUNCATED', 'COLUMNS_TRUNCATED', 'VALUES_SHORTENED',
                              'RESPONSE_SIZE_CAPPED'})


class PreviewLimits(ContractModel):
    max_response_bytes: Literal[65536] = MAX_RESPONSE_BYTES
    max_sheets: Literal[10] = MAX_SHEETS
    max_columns: Literal[100] = MAX_COLUMNS
    max_sample_rows: Literal[10] = MAX_SAMPLE_ROWS
    max_cells: Literal[300] = MAX_CELLS
    max_cell_bytes: Literal[96] = MAX_CELL_BYTES


class PreviewWarning(ContractModel):
    code: WarningCode
    sheet: SafeText | None
    message: Annotated[str, StringConstraints(min_length=1, max_length=300)]


class PreviewColumn(ContractModel):
    index: Annotated[int, Field(ge=1, le=MAX_COLUMNS)]
    name: SafeText
    inferred_type: Literal['INTEGER', 'NUMBER', 'BOOLEAN', 'DATE', 'TEXT', 'UNKNOWN',
                           'MIXED', 'FORMULA', 'ERROR']
    missing_values: Annotated[int, Field(ge=0, le=10000)]
    profiled_values: Annotated[int, Field(ge=0, le=10000)]
    missing_values_exact: bool


class PreviewRow(ContractModel):
    row_number: Annotated[int, Field(ge=1, le=1048576)]
    cells: Annotated[list[SafeText], Field(max_length=MAX_COLUMNS)]


class Dimensions(ContractModel):
    used_range: SafeText | None
    row_count: Annotated[int, Field(ge=0)] | None
    data_row_count: Annotated[int, Field(ge=0)] | None
    row_count_estimated: bool
    scanned_rows: Annotated[int, Field(ge=0)]
    column_count: Annotated[int, Field(ge=0)] | None


class PreviewSheet(ContractModel):
    name: SafeText
    state: Literal['visible', 'hidden', 'veryHidden']
    header_row: Annotated[int, Field(ge=1)] | None
    formula_presence: bool | None
    dimensions: Dimensions
    columns: Annotated[list[PreviewColumn], Field(max_length=MAX_COLUMNS)]
    sample_rows: Annotated[list[PreviewRow], Field(max_length=MAX_SAMPLE_ROWS)]
    truncated: bool


class DatasetPreview(ContractModel):
    schema_version: Literal['1.0'] = '1.0'
    source_id: UUID
    source_version_id: UUID
    version_number: Annotated[int, Field(ge=1)]
    original_filename: SafeText
    size_bytes: Annotated[int, Field(ge=1)]
    content_sha256: Annotated[str, StringConstraints(pattern=r'^[0-9a-f]{64}$')]
    format: Literal['CSV', 'XLSX']
    formulas_evaluated: Literal[False] = False
    truncated: bool
    limits: PreviewLimits = PreviewLimits()
    warnings: Annotated[list[PreviewWarning], Field(max_length=100)]
    sheets: Annotated[list[PreviewSheet], Field(max_length=MAX_SHEETS)]
