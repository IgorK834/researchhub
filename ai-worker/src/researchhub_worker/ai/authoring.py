"""Bounded authoring output. Product authorization/approval remain in Spring."""
from __future__ import annotations

import hashlib
import json
import re
from typing import Literal
from pydantic import Field, model_validator
from ..contract_model import ContractModel
from .contracts import Hash, ModelMetadata, UsageMetadata, Identifier
from .context import CitationKey
from uuid import UUID


class LocalMatch(ContractModel):
    citation_key: CitationKey
    category: Literal['supporting', 'related', 'insufficient']
    relevance: float = Field(ge=0, le=1, allow_inf_nan=False)
    reason: str = Field(min_length=1, max_length=1000)


class LocalAuthoringAnswer(ContractModel):
    status: Literal['READY', 'INSUFFICIENT_EVIDENCE']
    text: str = Field(max_length=12000)
    citation_keys: list[CitationKey] = Field(max_length=12)
    matches: list[LocalMatch] = Field(max_length=12)

    @model_validator(mode='after')
    def consistent(self):
        if (len(set(self.citation_keys)) != len(self.citation_keys)
                or len({m.citation_key for m in self.matches}) != len(self.matches)
                or self.status == 'INSUFFICIENT_EVIDENCE' and (self.text or self.citation_keys)
                or self.status == 'READY' and not (self.text.strip() or self.matches)):
            raise ValueError('Invalid authoring answer')
        return self


class Match(ContractModel):
    chunk_id: Hash
    category: Literal['supporting', 'related', 'insufficient']
    relevance: float = Field(ge=0, le=1, allow_inf_nan=False)
    reason: str = Field(min_length=1, max_length=1000)


class AuthoringAnswer(ContractModel):
    status: Literal['READY', 'INSUFFICIENT_EVIDENCE']
    text: str = Field(max_length=12000)
    citation_ids: list[Hash] = Field(max_length=12)
    matches: list[Match] = Field(max_length=12)


class AuthoringResult(ContractModel):
    schema_version: Literal['1.0']
    request_id: UUID
    template_id: Identifier
    template_hash: Hash
    model: ModelMetadata
    usage: UsageMetadata
    provider_request_id: Identifier
    answer: AuthoringAnswer

    def validate_for(self, contextual):
        request = contextual.request
        if (self.request_id != request.request_id or self.template_id != request.template_id
                or self.template_hash != request.template_hash):
            raise ValueError('Invalid authoring identity')
        mapping = {binding.chunk_id: binding.citation_key for binding in contextual.context.summary.citations}
        local = LocalAuthoringAnswer(status=self.answer.status, text=self.answer.text,
            citation_keys=[mapping[key] for key in self.answer.citation_ids],
            matches=[LocalMatch(citation_key=mapping[m.chunk_id], category=m.category,
                               relevance=m.relevance, reason=m.reason) for m in self.answer.matches])
        validate_answer(local, contextual)


def instruction(contextual):
    fields = json.loads(contextual.request.instruction)
    if (not isinstance(fields, dict) or fields.get('kind') not in {'DRAFT', 'REWRITE', 'EVIDENCE'}
            or contextual.request.template_id != f"authoring-{fields['kind'].lower()}:1"
            or not isinstance(fields.get('selectedText'), str) or len(fields['selectedText']) > 2000
            or not isinstance(fields.get('surroundingContext'), str) or len(fields['surroundingContext']) > 401
            or not isinstance(fields.get('instruction'), str) or not 1 <= len(fields['instruction']) <= 1000
            or fields.get('stylePreset') not in {'ACADEMIC', 'CONCISE', 'PLAIN'}
            or type(fields.get('lengthTarget')) is not int or not 20 <= fields['lengthTarget'] <= 1000
            or type(fields.get('citationRequired')) is not bool
            or fields['kind'] == 'REWRITE' and fields.get('action') not in {
                'IMPROVE_ACADEMIC_STYLE', 'SHORTEN', 'EXPAND', 'CLARIFY', 'FIX_GRAMMAR', 'EXPLAIN'}):
        raise ValueError('Invalid authoring instruction')
    return fields


def validate_answer(answer, contextual):
    fields = instruction(contextual)
    allowed = {binding.citation_key for binding in contextual.context.summary.citations}
    if (not set(answer.citation_keys) <= allowed or any(m.citation_key not in allowed for m in answer.matches)
            or fields['kind'] == 'EVIDENCE' and (answer.text or answer.citation_keys)
            or fields['kind'] != 'EVIDENCE' and (answer.matches or answer.status == 'READY' and not answer.text.strip())
            or fields['kind'] != 'EVIDENCE' and answer.status == 'READY'
                and (fields['kind'] == 'DRAFT' or fields['citationRequired']) and not answer.citation_keys):
        raise ValueError('Invalid authoring evidence')


def fake_answer(contextual):
    fields = instruction(contextual)
    evidence = contextual.request.evidence
    keys = [b.citation_key for b in contextual.context.summary.citations]
    if fields['kind'] == 'EVIDENCE':
        words = set(re.findall(r'\w+', fields['selectedText'].casefold()))
        matches = []
        for key, item in zip(keys, evidence):
            overlap = words & set(re.findall(r'\w+', item.content.casefold()))
            score = len(overlap) / max(1, len(words))
            # Topic overlap is not entailment. Only an exact extract is supporting in this fixture.
            category = ('supporting' if fields['selectedText'].casefold() in item.content.casefold()
                        else 'related' if score > 0 else 'insufficient')
            matches.append(LocalMatch(citation_key=key, category=category, relevance=score,
                reason='Offline lexical fixture; verify the claim against the source snippet.'))
        return LocalAuthoringAnswer(status='READY' if any(m.category != 'insufficient' for m in matches)
            else 'INSUFFICIENT_EVIDENCE', text='', citation_keys=[], matches=matches)
    if fields['kind'] == 'DRAFT' or fields['citationRequired']:
        if not evidence:
            return LocalAuthoringAnswer(status='INSUFFICIENT_EVIDENCE', text='', citation_keys=[], matches=[])
        return LocalAuthoringAnswer(status='READY', text='\n\n'.join(e.content[:1500] for e in evidence[:4]), citation_keys=keys[:4], matches=[])
    text = fields['selectedText']
    action = fields['action']
    if action == 'SHORTEN':
        words = text.split(); text = ' '.join(words[:max(1, len(words) // 2)])
    elif action == 'FIX_GRAMMAR':
        text = ' '.join(text.split()); text = text[0].upper() + text[1:]
        if text[-1] not in '.!?': text += '.'
    elif action == 'EXPAND' and evidence:
        text += '\n\n' + evidence[0].content[:1500]
    # Other actions deliberately echo in offline mode; no claim of production LLM quality.
    return LocalAuthoringAnswer(status='READY', text=text, citation_keys=keys[:1] if action == 'EXPAND' and evidence else [], matches=[])


def generate_authoring(provider, contextual):
    from .providers import FakeModelProvider, StructuredChatProvider, ProviderError
    instruction(contextual)
    if isinstance(provider, FakeModelProvider):
        answer = fake_answer(contextual)
        payload = None
    elif isinstance(provider, StructuredChatProvider):
        payload = provider.complete(contextual, AUTHORING_SCHEMA, 'researchhub_authoring_v1')
        answer = LocalAuthoringAnswer.model_validate_json(payload['choices'][0]['message']['content'])
    else:
        raise ProviderError('AI_PROVIDER_ERROR')
    validate_answer(answer, contextual)
    mapping = {b.citation_key: b.chunk_id for b in contextual.context.summary.citations}
    resolved = AuthoringAnswer(status=answer.status, text=answer.text,
        citation_ids=[mapping[key] for key in answer.citation_keys],
        matches=[Match(chunk_id=mapping[m.citation_key], category=m.category, relevance=m.relevance, reason=m.reason) for m in answer.matches])
    usage = payload['usage'] if payload else None
    input_tokens = len(contextual.user_message().split()) + len(contextual.request.system_instruction.split())
    output_tokens = len(answer.model_dump_json().split())
    request = contextual.request
    return AuthoringResult(schema_version='1.0', request_id=request.request_id, template_id=request.template_id,
        template_hash=request.template_hash, model=provider.model_metadata(),
        usage=UsageMetadata(input_tokens=usage['prompt_tokens'] if usage else input_tokens,
            output_tokens=usage['completion_tokens'] if usage else output_tokens,
            total_tokens=usage['total_tokens'] if usage else input_tokens + output_tokens, estimated=not bool(payload)),
        provider_request_id=payload['id'] if payload else hashlib.sha256(answer.model_dump_json().encode()).hexdigest(), answer=resolved)


AUTHORING_SCHEMA = {
    'type': 'object', 'additionalProperties': False,
    'properties': {
        'status': {'type': 'string', 'enum': ['READY', 'INSUFFICIENT_EVIDENCE']},
        'text': {'type': 'string'}, 'citationKeys': {'type': 'array', 'items': {'type': 'string'}},
        'matches': {'type': 'array', 'items': {'type': 'object', 'additionalProperties': False,
            'properties': {'citationKey': {'type': 'string'}, 'category': {'type': 'string', 'enum': ['supporting', 'related', 'insufficient']},
                           'relevance': {'type': 'number'}, 'reason': {'type': 'string'}},
            'required': ['citationKey', 'category', 'relevance', 'reason']}},
    }, 'required': ['status', 'text', 'citationKeys', 'matches'],
}
