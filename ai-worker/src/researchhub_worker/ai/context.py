"""Validate application-built context before inference; no storage or retrieval capabilities."""
from __future__ import annotations

import hashlib
import json
from typing import Annotated, Literal
from uuid import UUID
from pydantic import Field, StrictBool, StrictInt, StringConstraints, model_validator

from ..contract_model import ContractModel
from .contracts import GenerationRequest, Hash, Claim, StructuredAnswer
from ..retrieval.contracts import SourceSpan

CitationKey = Annotated[str, StringConstraints(pattern=r'^[SA](?:[1-9]|1[0-2])$')]
FRAMING_RESERVE = 2048


class ContextBudget(ContractModel):
    max_tokens: StrictInt = Field(ge=64, le=131072)
    max_bytes: StrictInt = Field(ge=64, le=131072)
    collapse_exact_duplicates: StrictBool


class CitationBinding(ContractModel):
    citation_key: CitationKey
    chunk_id: Hash
    text_reference: CitationKey | None


class ContextSummary(ContractModel):
    builder_version: Literal['1.0', '2.0']
    token_policy: Literal['utf8-conservative-v1']
    budget: ContextBudget
    context_hash: Hash
    context_bytes: StrictInt = Field(ge=0)
    token_upper_bound: StrictInt = Field(ge=0)
    citations: list[CitationBinding] = Field(max_length=12)


class BuiltContext(ContractModel):
    summary: ContextSummary
    text: str = Field(max_length=131072)


class ContextBlock(ContractModel):
    chunk_id: Hash
    source_id: UUID
    title: str = Field(min_length=1, max_length=255)
    page_start: StrictInt | None = Field(ge=1)
    page_end: StrictInt | None = Field(ge=1)
    section_title: str | None
    processing_version: str = Field(min_length=1, max_length=128)
    spans: list[SourceSpan] = Field(min_length=1, max_length=1024)
    text: str | None
    text_reference: CitationKey | None


class AnalysisContextBlock(ContractModel):
    kind: Literal['ANALYSIS']
    chunk_id: Hash
    analysis_id: UUID
    execution_id: UUID
    output_id: str = Field(min_length=1, max_length=100)
    title: str = Field(min_length=1, max_length=1000)
    execution_hash: Hash
    executed_at: str = Field(min_length=1, max_length=100)
    text: str = Field(min_length=1, max_length=8000)
    text_reference: None


class ContextualRequest(ContractModel):
    schema_version: Literal['2.0']
    request: GenerationRequest
    context: BuiltContext

    def blocks(self):
        lines = self.context.text.split('\n') if self.context.text else []
        if len(lines) != 2 * len(self.context.summary.citations):
            raise ValueError('Invalid context framing')
        result = []
        for index, binding in enumerate(self.context.summary.citations):
            if lines[2 * index] != f'[{binding.citation_key}]':
                raise ValueError('Invalid local citation label')
            model = AnalysisContextBlock if binding.citation_key.startswith('A') else ContextBlock
            result.append(model.model_validate_json(lines[2 * index + 1]))
        return result

    def user_message(self):
        return json.dumps({'instruction': self.request.instruction, 'context': self.context.text}, ensure_ascii=False, separators=(',', ':'))

    @model_validator(mode='after')
    def valid_context(self):
        summary = self.context.summary
        raw = self.context.text.encode('utf-8')
        expected_tokens = len(self.request.system_instruction.encode('utf-8')) + len(self.user_message().encode('utf-8')) + FRAMING_RESERVE + self.request.parameters.max_output_tokens
        if (hashlib.sha256(raw).hexdigest() != summary.context_hash or len(raw) != summary.context_bytes
                or expected_tokens != summary.token_upper_bound or len(raw) > summary.budget.max_bytes
                or expected_tokens > summary.budget.max_tokens
                or [item.chunk_id for item in summary.citations] != [item.chunk_id for item in self.request.evidence]
                or sum(len(block.spans) for block in self.blocks() if isinstance(block, ContextBlock)) > 1024):
            raise ValueError('Invalid context hash, budget or evidence mapping')
        previous = {}
        source_count, analysis_count = 0, 0
        for index, (binding, block, evidence) in enumerate(zip(summary.citations, self.blocks(), self.request.evidence)):
            computed = isinstance(block, AnalysisContextBlock)
            if computed:
                analysis_count += 1
                expected_key = f'A{analysis_count}'
                if summary.builder_version != '2.0' or binding.text_reference is not None:
                    raise ValueError('Computed context requires an independent analysis citation')
            else:
                source_count += 1
                expected_key = f'S{source_count}'
            if (binding.citation_key != expected_key or block.chunk_id != evidence.chunk_id
                    or not block.title.strip() or block.text_reference != binding.text_reference
                    or not computed and ((block.page_start is None) != (block.page_end is None)
                    or block.page_start is not None and block.page_end < block.page_start)):
                raise ValueError('Invalid context location or citation')
            if binding.text_reference is None:
                if block.text != evidence.content:
                    raise ValueError('Context text differs from retrieved evidence')
            elif (not summary.budget.collapse_exact_duplicates or block.text is not None
                    or previous.get(binding.text_reference) != evidence.content):
                raise ValueError('Invalid duplicate context reference')
            previous[binding.citation_key] = evidence.content
        return self


class LocalClaim(ContractModel):
    text: str = Field(min_length=1, max_length=2000)
    citation_keys: list[CitationKey] = Field(min_length=1, max_length=12)

    @model_validator(mode='after')
    def valid_claim(self):
        if not self.text.strip() or len(set(self.citation_keys)) != len(self.citation_keys):
            raise ValueError('Invalid local claim')
        return self


class LocalAnswer(ContractModel):
    status: Literal['SUPPORTED', 'INSUFFICIENT_EVIDENCE']
    claims: list[LocalClaim] = Field(max_length=12)

    def to_structured(self, context):
        mapping = {item.citation_key: item.chunk_id for item in context.summary.citations}
        return StructuredAnswer(status=self.status, claims=[Claim(text=item.text,
            evidence_ids=[mapping[key] for key in item.citation_keys]) for item in self.claims])


LOCAL_ANSWER_SCHEMA = {
    'type': 'object', 'additionalProperties': False,
    'properties': {
        'status': {'type': 'string', 'enum': ['SUPPORTED', 'INSUFFICIENT_EVIDENCE']},
        'claims': {'type': 'array', 'items': {'type': 'object', 'additionalProperties': False,
            'properties': {'text': {'type': 'string'}, 'citationKeys': {'type': 'array', 'items': {'type': 'string'}}},
            'required': ['text', 'citationKeys']}},
    }, 'required': ['status', 'claims'],
}
