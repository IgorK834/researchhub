"""Optional CSV asset profile v1. Original cell values remain strings, never executable code."""
from typing import Annotated, Literal
from pydantic import Field, StrictBool, StrictInt, StringConstraints, model_validator
from .contract_model import ContractModel


class CsvColumn(ContractModel):
    column_number: Annotated[StrictInt, Field(ge=1, le=256)]
    name: Annotated[str, StringConstraints(min_length=1, max_length=500)]
    inferred_type: Literal['integer', 'number', 'boolean', 'date', 'text', 'unknown']
    missing_count: Annotated[StrictInt, Field(ge=0, le=10000)]


class CsvProfile(ContractModel):
    schema_version: Literal['1.0'] = '1.0'
    encoding: Literal['UTF-8', 'UTF-8-BOM']
    delimiter: Literal[',', ';', '\t', '|'] | None
    header_policy: Literal['FIRST_NONEMPTY_RECORD'] = 'FIRST_NONEMPTY_RECORD'
    missing_value_policy: Literal['EMPTY_OR_WHITESPACE'] = 'EMPTY_OR_WHITESPACE'
    index_policy: Literal['SCHEMA_ONLY'] = 'SCHEMA_ONLY'
    row_count: Annotated[StrictInt, Field(ge=0, le=10000)] | None
    profiled_row_count: Annotated[StrictInt, Field(ge=0, le=10000)]
    row_scan_complete: StrictBool
    columns: Annotated[list[CsvColumn], Field(min_length=1, max_length=256)]

    @model_validator(mode='after')
    def consistent_profile(self):
        if self.row_count != (self.profiled_row_count if self.row_scan_complete else None):
            raise ValueError('CSV row count must describe the bounded data scan')
        if [c.column_number for c in self.columns] != list(range(1, len(self.columns) + 1)):
            raise ValueError('CSV column order must be contiguous')
        if len({c.name for c in self.columns}) != len(self.columns):
            raise ValueError('CSV schema names must be unique')
        if any(c.missing_count > self.profiled_row_count or
               ((c.inferred_type == 'unknown') != (c.missing_count == self.profiled_row_count))
               for c in self.columns):
            raise ValueError('CSV missing counts and inferred types must describe the data scan')
        return self
