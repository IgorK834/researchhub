"""Computation-plan v1. Mirrors AnalysisContracts; physical indices are the column identity."""
import json
from typing import Annotated, Literal
from uuid import UUID
from pydantic import Field, model_validator
from ..contract_model import ContractModel
from ..data.contracts import DatasetPreview
from ..ai.contracts import GenerationRequest, ModelMetadata, UsageMetadata

Column = Annotated[int, Field(strict=True, ge=1, le=100)]
Columns = Annotated[list[Column], Field(min_length=1, max_length=100)]
Name = Annotated[str, Field(min_length=1, max_length=96)]
Note = Annotated[str, Field(min_length=1, max_length=1000)]


class Input(ContractModel):
    source_id: UUID
    source_version_id: UUID
    sheet_name: Name | None
    columns: Columns | None

    @model_validator(mode='after')
    def valid_selection(self):
        if self.columns is not None and (self.sheet_name is None or len(set(self.columns)) != len(self.columns)):
            raise ValueError('Invalid column selection')
        if self.sheet_name is not None and not self.sheet_name.strip():
            raise ValueError('Empty sheet')
        return self


class InspectedInput(ContractModel):
    selection: Input
    preview: DatasetPreview

    @model_validator(mode='after')
    def matching(self):
        if (self.selection.source_id != self.preview.source_id
                or self.selection.source_version_id != self.preview.source_version_id):
            raise ValueError('Inspection identity mismatch')
        if self.selection.sheet_name is not None:
            sheet = next((s for s in self.preview.sheets if s.name == self.selection.sheet_name), None)
            if sheet is None or self.selection.columns is not None and not set(self.selection.columns) <= {c.index for c in sheet.columns}:
                raise ValueError('Selection outside inspected metadata')
        return self


class PlanningRequest(ContractModel):
    schema_version: Literal['1.0']
    analysis_id: UUID
    request: GenerationRequest
    inputs: list[InspectedInput] = Field(min_length=1, max_length=5)
    repair_hints: list[Note] = Field(max_length=1)

    @model_validator(mode='after')
    def unique(self):
        if (self.request.template_id not in ('computation-plan:1', 'computation-plan:2', 'computation-plan:3') or self.request.evidence
                or len({i.selection.source_version_id for i in self.inputs}) != len(self.inputs)):
            raise ValueError('Invalid planning request')
        return self

    def user_message(self):
        # A fixed protocol guides model-generated programs; the immutable application manifest supplies paths.
        protocol = 'Execution protocol: Python 3.13.3 with pinned scientific packages. Read only declared immutable inputs and the controlled /execution/manifest.json. Write /outputs/result.json using result schemaVersion 2.0 and the exact declared TABLE/CHART/TEXT names. TABLE has columns and computed rows of finite JSON scalars; TEXT has text. CHART has file (simple .png or passive .svg basename), title, xAxis and yAxis ({label,unit:null or string,scale:LINEAR or LOG}), series:[{name,tableName,xColumn,yColumn,yTransform:IDENTITY or ABS}]. Series reference actual numeric columns in persisted TABLE outputs; use [] when unavailable. Never supply source analysis IDs, code hashes or point counts. Maximum 100 columns, 10000 rows, 100000 total cells, 1 MiB JSON, 8 MiB/chart, 16 MiB total. No additional files, network, credentials, package installation or application access. Numeric results come from full immutable input, never preview samples.'
        data = self.model_dump(mode='json', by_alias=True)
        data['executionProtocol'] = protocol
        return json.dumps(data, ensure_ascii=False, separators=(',', ':'))


class PlanInput(ContractModel):
    source_version_id: UUID
    sheet_name: Name
    required_columns: Columns


class Step(ContractModel):
    name: str = Field(min_length=1, max_length=100)
    description: Note
    source_version_id: UUID
    sheet_name: Name
    columns: Columns


class Output(ContractModel):
    kind: Literal['TABLE', 'CHART', 'TEXT']
    name: str = Field(min_length=1, max_length=100)
    description: Note
    source_version_ids: list[UUID] = Field(min_length=1, max_length=5)


class Code(ContractModel):
    language: Literal['PYTHON']
    source: str = Field(min_length=1, max_length=32000)


class Plan(ContractModel):
    schema_version: Literal['1.0']
    summary: str = Field(min_length=1, max_length=2000)
    inputs: list[PlanInput] = Field(min_length=1, max_length=50)
    transformations: list[Step] = Field(max_length=20)
    statistical_operations: list[Step] = Field(max_length=20)
    outputs: list[Output] = Field(min_length=1, max_length=10)
    assumptions: list[Note] = Field(max_length=20)
    warnings: list[Note] = Field(max_length=20)
    code: Code

    @model_validator(mode='after')
    def consistent(self):
        if len({o.name for o in self.outputs}) != len(self.outputs):
            raise ValueError('Duplicate output name')
        for columns in [i.required_columns for i in self.inputs] + [s.columns for s in self.transformations + self.statistical_operations]:
            if len(set(columns)) != len(columns):
                raise ValueError('Duplicate column reference')
        if any(len(set(o.source_version_ids)) != len(o.source_version_ids) for o in self.outputs):
            raise ValueError('Duplicate output reference')
        # Match Java's nonblank contract, including code. No parsing/compilation/evaluation of source.
        for value in [self.summary, self.code.source] + self.assumptions + self.warnings + [i.sheet_name for i in self.inputs] + [v for s in self.transformations + self.statistical_operations for v in (s.name, s.description, s.sheet_name)] + [v for o in self.outputs for v in (o.name, o.description)]:
            if not value.strip():
                raise ValueError('Blank plan field')
        return self

    def validate_for(self, request):
        provided = {i.selection.source_version_id: i for i in request.inputs}
        references = {}
        for item in self.inputs:
            inspected = provided.get(item.source_version_id)
            if inspected is None:
                raise ValueError('Unprovided input')
            selected = inspected.selection
            sheet = next((s for s in inspected.preview.sheets if s.name == item.sheet_name), None)
            key = (item.source_version_id, item.sheet_name)
            if (sheet is None or key in references or selected.sheet_name is not None and selected.sheet_name != item.sheet_name
                    or not set(item.required_columns) <= {c.index for c in sheet.columns}
                    or selected.columns is not None and not set(item.required_columns) <= set(selected.columns)):
                raise ValueError('Reference outside inspected selection')
            references[key] = set(item.required_columns)
        for step in self.transformations + self.statistical_operations:
            required = references.get((step.source_version_id, step.sheet_name))
            if required is None or not set(step.columns) <= required:
                raise ValueError('Undeclared operation input')
        versions = {i.source_version_id for i in self.inputs}
        if any(not set(output.source_version_ids) <= versions for output in self.outputs):
            raise ValueError('Unprovided output input')


class Candidate(ContractModel):
    schema_version: Literal['1.0']
    request_id: UUID
    model: ModelMetadata
    usage: UsageMetadata
    provider_request_id: str = Field(min_length=1, max_length=200)
    output: str = Field(min_length=1, max_length=64000)


PLAN_SCHEMA = Plan.model_json_schema(by_alias=True)
