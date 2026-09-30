"""Model gateway v1. All model input is explicit, bounded text and evidence."""
from __future__ import annotations

import hashlib
from typing import Annotated, Literal
from uuid import UUID

from pydantic import Field, StrictInt, StrictBool, StringConstraints, model_validator
from ..contract_model import ContractModel

Identifier = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=128)]
Hash = Annotated[str, StringConstraints(pattern=r'^[0-9a-f]{64}$')]


class ModelMetadata(ContractModel):
    provider: Identifier
    name: Identifier
    version: Identifier
    structured_output: Literal[True] = True
    streaming: Literal[False] = False


class ModelParameters(ContractModel):
    temperature: float | None = Field(default=None, ge=0, le=2, allow_inf_nan=False)
    max_output_tokens: StrictInt = Field(ge=16, le=8192)


class Evidence(ContractModel):
    chunk_id: Hash
    content_hash: Hash
    content: str = Field(min_length=1, max_length=8000)

    @model_validator(mode='after')
    def valid_content(self):
        if not self.content.strip() or hashlib.sha256(self.content.encode()).hexdigest() != self.content_hash:
            raise ValueError('Invalid evidence content hash')
        return self


class GenerationRequest(ContractModel):
    schema_version: Literal['1.0']
    request_id: UUID
    template_id: Identifier
    template_hash: Hash
    system_instruction: str = Field(min_length=1, max_length=4000)
    instruction: str = Field(min_length=1, max_length=4000)
    parameters: ModelParameters
    evidence: list[Evidence] = Field(max_length=12)

    @model_validator(mode='after')
    def valid_template_and_context(self):
        if (not self.instruction.strip() or not self.system_instruction.strip()
                or hashlib.sha256(self.system_instruction.encode()).hexdigest() != self.template_hash
                or len({item.chunk_id for item in self.evidence}) != len(self.evidence)):
            raise ValueError('Invalid generation template or evidence')
        return self


class Claim(ContractModel):
    text: str = Field(min_length=1, max_length=2000)
    evidence_ids: list[Hash] = Field(min_length=1, max_length=12)

    @model_validator(mode='after')
    def nonblank_and_unique(self):
        if not self.text.strip() or len(set(self.evidence_ids)) != len(self.evidence_ids):
            raise ValueError('Invalid claim')
        return self


class StructuredAnswer(ContractModel):
    status: Literal['SUPPORTED', 'INSUFFICIENT_EVIDENCE']
    claims: list[Claim] = Field(max_length=12)

    @model_validator(mode='after')
    def consistent_status(self):
        if (self.status == 'SUPPORTED') != bool(self.claims):
            raise ValueError('Answer status differs from evidence-backed claims')
        return self

    def validate_evidence(self, evidence):
        allowed = {item.chunk_id for item in evidence}
        if any(not set(claim.evidence_ids) <= allowed for claim in self.claims):
            raise ValueError('Model invented an evidence reference')


class UsageMetadata(ContractModel):
    input_tokens: StrictInt = Field(ge=0, le=20_000_000)
    output_tokens: StrictInt = Field(ge=0, le=20_000_000)
    total_tokens: StrictInt = Field(ge=0, le=40_000_000)
    estimated: StrictBool

    @model_validator(mode='after')
    def valid_total(self):
        if self.total_tokens != self.input_tokens + self.output_tokens:
            raise ValueError('Invalid usage total')
        return self


class GenerationResult(ContractModel):
    schema_version: Literal['1.0']
    request_id: UUID
    template_id: Identifier
    template_hash: Hash
    model: ModelMetadata
    usage: UsageMetadata
    provider_request_id: Identifier
    answer: StructuredAnswer

    def validate_for(self, request):
        if (self.request_id != request.request_id or self.template_id != request.template_id
                or self.template_hash != request.template_hash):
            raise ValueError('Model result identity differs from request')
        self.answer.validate_evidence(request.evidence)


# Foundry's strict subset excludes min/max/pattern constraints; enforce those locally above.
ANSWER_SCHEMA = {
    'type': 'object', 'additionalProperties': False,
    'properties': {
        'status': {'type': 'string', 'enum': ['SUPPORTED', 'INSUFFICIENT_EVIDENCE']},
        'claims': {'type': 'array', 'items': {'type': 'object', 'additionalProperties': False,
            'properties': {'text': {'type': 'string'}, 'evidenceIds': {'type': 'array', 'items': {'type': 'string'}}},
            'required': ['text', 'evidenceIds']}},
    }, 'required': ['status', 'claims'],
}
