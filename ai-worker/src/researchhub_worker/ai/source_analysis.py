"""Strict, evidence-scoped source interpretations. Spring owns workspace authorization."""
from __future__ import annotations
import hashlib
import json
import re
from typing import Literal
from uuid import UUID
from pydantic import Field, model_validator
from ..contract_model import ContractModel
from .contracts import Hash, Identifier, ModelMetadata, UsageMetadata


class Cell(ContractModel):
    criterion: str = Field(min_length=1, max_length=64)
    status: Literal['REPORTED', 'MISSING']
    text: str | None = Field(max_length=1200)
    evidence_ids: list[str] = Field(max_length=12)

    @model_validator(mode='after')
    def consistent(self):
        if (len(set(self.evidence_ids)) != len(self.evidence_ids)
                or self.status == 'MISSING' and (self.text is not None or self.evidence_ids)
                or self.status == 'REPORTED' and (not self.text or not self.text.strip() or not self.evidence_ids)):
            raise ValueError('Invalid cell evidence')
        return self


class Row(ContractModel):
    source_id: UUID
    cells: list[Cell] = Field(max_length=5)


class Statement(ContractModel):
    text: str = Field(min_length=1, max_length=2000)
    evidence_ids: list[str] = Field(min_length=1, max_length=12)


class Side(ContractModel):
    source_id: UUID
    text: str = Field(min_length=1, max_length=1200)
    evidence_ids: list[str] = Field(min_length=1, max_length=12)


class Finding(ContractModel):
    category: Literal['POTENTIAL_DISAGREEMENT', 'DIFFERENT_REPORTED_RESULT', 'DIFFERENT_EXPERIMENTAL_CONDITIONS']
    description: str = Field(min_length=1, max_length=2000)
    sides: list[Side] = Field(min_length=2, max_length=2)
    methodological_context: Cell


class Answer(ContractModel):
    status: Literal['READY', 'INSUFFICIENT_EVIDENCE', 'NO_POTENTIAL_DISAGREEMENT']
    rows: list[Row] = Field(max_length=5)
    summary: list[Statement] = Field(max_length=5)
    findings: list[Finding] = Field(max_length=5)


class AnalysisResult(ContractModel):
    schema_version: Literal['1.0']
    request_id: UUID
    template_id: Identifier
    template_hash: Hash
    model: ModelMetadata
    usage: UsageMetadata
    provider_request_id: Identifier
    answer: Answer

    def validate_for(self, contextual):
        request = contextual.request
        if (self.request_id != request.request_id or self.template_id != request.template_id
                or self.template_hash != request.template_hash):
            raise ValueError('Invalid analysis identity')
        validate_answer(self.answer, instruction(contextual), {b.chunk_id: b.source_id for b in contextual.blocks()})


def instruction(contextual):
    fields = json.loads(contextual.request.instruction)
    if (not isinstance(fields, dict) or set(fields) != {'kind', 'selectedSourceIds', 'criteria', 'instruction', 'parentComparisonId'}
            or fields['kind'] not in {'COMPARISON', 'DISAGREEMENTS'}
            or contextual.request.template_id != f"source-{fields['kind'].lower()}:1"
            or not isinstance(fields['selectedSourceIds'], list) or not 2 <= len(fields['selectedSourceIds']) <= 5
            or not isinstance(fields['criteria'], list) or not 1 <= len(fields['criteria']) <= 5
            or any(not isinstance(c, str) or not c.strip() or len(c) > 64 for c in fields['criteria'])
            or len({c.casefold() for c in fields['criteria']}) != len(fields['criteria'])
            or not isinstance(fields['instruction'], str) or not 1 <= len(fields['instruction']) <= 1000):
        raise ValueError('Invalid analysis instruction')
    sources = [UUID(source) for source in fields['selectedSourceIds']]
    if len(set(sources)) != len(sources):
        raise ValueError('Repeated source')
    if fields['kind'] == 'COMPARISON' and fields['parentComparisonId'] is not None:
        raise ValueError('Unexpected baseline')
    if fields['kind'] == 'DISAGREEMENTS':
        UUID(fields['parentComparisonId'])
    if any(b.source_id not in sources for b in contextual.blocks()):
        raise ValueError('Unselected evidence')
    return fields


def validate_answer(answer, fields, evidence):
    sources = [UUID(source) for source in fields['selectedSourceIds']]

    def cited(ids, source=None):
        if len(set(ids)) != len(ids) or any(key not in evidence or source is not None and evidence[key] != source for key in ids):
            raise ValueError('Unselected or misattributed evidence')

    if fields['kind'] == 'COMPARISON':
        if answer.findings or [r.source_id for r in answer.rows] != sources:
            raise ValueError('Invalid comparison rows')
        for row in answer.rows:
            if [c.criterion for c in row.cells] != fields['criteria']:
                raise ValueError('Invalid comparison criteria')
            for cell in row.cells:
                cited(cell.evidence_ids, row.source_id)
        reported = any(c.status == 'REPORTED' for r in answer.rows for c in r.cells)
        if (reported and (answer.status != 'READY' or not answer.summary)
                or not reported and (answer.status != 'INSUFFICIENT_EVIDENCE' or answer.summary)):
            raise ValueError('Invalid comparison status')
        for summary in answer.summary:
            cited(summary.evidence_ids)
    else:
        if (answer.rows or answer.summary or bool(answer.findings) != (answer.status == 'READY')
                or (answer.status == 'INSUFFICIENT_EVIDENCE') != (len(set(evidence.values())) < 2)):
            raise ValueError('Invalid disagreement status')
        for finding in answer.findings:
            if len({s.source_id for s in finding.sides}) != 2:
                raise ValueError('Two distinct sides are required')
            for side in finding.sides:
                if side.source_id not in sources:
                    raise ValueError('Unselected side')
                cited(side.evidence_ids, side.source_id)
            cited(finding.methodological_context.evidence_ids)


def fake_answer(contextual, fields):
    # An offline fixture only extracts explicitly labelled fields; it never infers research facts.
    rows = []
    for source in fields['selectedSourceIds']:
        cells = []
        for criterion in fields['criteria']:
            text, key = None, None
            for block, evidence, binding in zip(contextual.blocks(), contextual.request.evidence, contextual.context.summary.citations):
                if str(block.source_id) == source:
                    match = re.search(r'(?im)^\s*' + re.escape(criterion) + r'\s*:\s*([^\r\n]+)', evidence.content)
                    if match:
                        text, key = match.group(1).strip()[:1200], binding.citation_key
                        if text:
                            break
            cells.append(Cell(criterion=criterion, status='REPORTED' if text else 'MISSING', text=text,
                              evidence_ids=[key] if text else []))
        rows.append(Row(source_id=source, cells=cells))
    reported = [c for r in rows for c in r.cells if c.status == 'REPORTED']
    if fields['kind'] == 'COMPARISON':
        return Answer(status='READY' if reported else 'INSUFFICIENT_EVIDENCE', rows=rows,
            summary=[Statement(text='Explicitly reported fields from retrieved excerpts: ' + ', '.join(dict.fromkeys(c.criterion for c in reported)),
                               evidence_ids=list(dict.fromkeys(key for c in reported for key in c.evidence_ids)))] if reported else [], findings=[])
    findings = []
    for index, left in enumerate(rows):
        for right in rows[index + 1:]:
            for a, b in zip(left.cells, right.cells):
                if a.status != 'REPORTED' or b.status != 'REPORTED' or a.text == b.text:
                    continue
                if len(findings) >= 5:
                    break
                context_cells = [c for r in (left, right) for c in r.cells if c.criterion.casefold() in {'method', 'dataset'} and c.status == 'REPORTED']
                context = Cell(criterion='methodological/context differences', status='REPORTED' if context_cells else 'MISSING',
                    text='; '.join(c.criterion + ': ' + c.text for c in context_cells)[:1200] if context_cells else None,
                    evidence_ids=list(dict.fromkeys(key for c in context_cells for key in c.evidence_ids)))
                findings.append(Finding(category='DIFFERENT_EXPERIMENTAL_CONDITIONS' if a.criterion.casefold() in {'method', 'dataset'} else 'DIFFERENT_REPORTED_RESULT',
                    description=f'Different explicit values for {a.criterion}; this does not establish a contradiction.' +
                        (' Methodological context is unavailable in these excerpts.' if not context_cells else ' Review methodological and contextual differences.'),
                    sides=[Side(source_id=left.source_id, text=a.text, evidence_ids=a.evidence_ids),
                           Side(source_id=right.source_id, text=b.text, evidence_ids=b.evidence_ids)], methodological_context=context))
    count = len({b.source_id for b in contextual.blocks()})
    return Answer(status='INSUFFICIENT_EVIDENCE' if count < 2 else 'READY' if findings else 'NO_POTENTIAL_DISAGREEMENT',
                  rows=[], summary=[], findings=findings if count >= 2 else [])


def generate_analysis(provider, contextual):
    from .providers import FakeModelProvider, FoundryModelProvider, OpenAiCompatibleModelProvider, ProviderError
    fields = instruction(contextual)
    if isinstance(provider, FakeModelProvider):
        answer, payload = fake_answer(contextual, fields), None
    elif isinstance(provider, (FoundryModelProvider, OpenAiCompatibleModelProvider)):
        payload = provider.complete(contextual, ANALYSIS_SCHEMA, 'researchhub_source_analysis_v1')
        answer = Answer.model_validate_json(payload['choices'][0]['message']['content'])
    else:
        raise ProviderError('AI_PROVIDER_ERROR')
    validate_answer(answer, fields, {binding.citation_key: block.source_id for binding, block in zip(contextual.context.summary.citations, contextual.blocks())})
    mapping = {b.citation_key: b.chunk_id for b in contextual.context.summary.citations}

    def resolve(value):
        if isinstance(value, dict):
            return {key: [mapping[item] for item in val] if key == 'evidenceIds' else resolve(val) for key, val in value.items()}
        if isinstance(value, list):
            return [resolve(v) for v in value]
        return value

    resolved = Answer.model_validate(resolve(answer.model_dump(by_alias=True)))
    usage = payload['usage'] if payload else None
    input_tokens = len(contextual.user_message().split()) + len(contextual.request.system_instruction.split())
    output_tokens = len(answer.model_dump_json().split())
    request = contextual.request
    return AnalysisResult(schema_version='1.0', request_id=request.request_id, template_id=request.template_id,
        template_hash=request.template_hash, model=provider.model_metadata(),
        usage=UsageMetadata(input_tokens=usage['prompt_tokens'] if usage else input_tokens,
            output_tokens=usage['completion_tokens'] if usage else output_tokens,
            total_tokens=usage['total_tokens'] if usage else input_tokens + output_tokens, estimated=not bool(payload)),
        provider_request_id=payload['id'] if payload else hashlib.sha256(answer.model_dump_json().encode()).hexdigest(), answer=resolved)


# All properties are required, including nullable text; extra properties are forbidden at every level.
ANALYSIS_SCHEMA = Answer.model_json_schema(by_alias=True)
