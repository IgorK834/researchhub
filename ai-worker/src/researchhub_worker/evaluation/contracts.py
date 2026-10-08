"""Public evaluation v1 contracts; fixture labels are never provider input."""
from __future__ import annotations

import re
from typing import Annotated, Any, Literal
from uuid import UUID

from pydantic import Field, StrictBool, StrictInt, model_validator

from ..ai.contracts import Hash, Identifier, ModelParameters, StructuredAnswer, UsageMetadata
from ..contract_model import ContractModel
from ..retrieval.contracts import ChunkingConfig, RetrievalChunk
from ..retrieval.embeddings import ModelMetadata as EmbeddingModelMetadata

Nonnegative = Annotated[float, Field(ge=0, allow_inf_nan=False)]
Rate = Annotated[float, Field(ge=0, le=1, allow_inf_nan=False)]


def validate_pattern(pattern):
    if not pattern.strip() or len(pattern) > 2000:
        raise ValueError('Invalid curated pattern')
    try:
        re.compile(pattern)
    except re.error:
        raise ValueError('Invalid curated regular expression') from None


class Location(ContractModel):
    source_id: UUID
    page: StrictInt | None = Field(default=None, ge=1)
    unit_id: Identifier
    character_start: StrictInt = Field(ge=0)
    character_end: StrictInt = Field(ge=1)
    # Exact IDs apply only to referenceChunking. Source spans survive rechunking.
    chunk_ids: list[Hash] = Field(default_factory=list, max_length=100)

    @model_validator(mode='after')
    def ordered(self):
        if self.character_start >= self.character_end or len(set(self.chunk_ids)) != len(self.chunk_ids):
            raise ValueError('Invalid expected location')
        return self


class Fact(ContractModel):
    id: Identifier
    description: str = Field(min_length=1, max_length=2000)
    # Regexes are reviewed fixture authoring data, never user/provider supplied rules.
    answer_patterns: list[str] = Field(min_length=1, max_length=20)
    supported_statements: list[str] = Field(min_length=1, max_length=20)
    locations: list[Location] = Field(min_length=1, max_length=20)

    @model_validator(mode='after')
    def compilable(self):
        for pattern in self.answer_patterns + self.supported_statements:
            validate_pattern(pattern)
        return self


class EvaluationCase(ContractModel):
    id: Identifier
    question: str = Field(min_length=1, max_length=2000)
    expected_answer: str = Field(min_length=1, max_length=4000)
    expected_status: Literal['SUPPORTED', 'INSUFFICIENT_EVIDENCE']
    expected_facts: list[Fact] = Field(max_length=30)
    expected_source_ids: list[UUID] = Field(max_length=100)
    workspace_fixture_id: UUID
    selected_source_ids: list[UUID] | None = Field(default=None, max_length=100)
    tags: list[Identifier] = Field(min_length=1, max_length=20)
    difficulty: Literal['easy', 'medium', 'hard']
    forbidden_patterns: list[str] = Field(default_factory=list, max_length=30)

    @model_validator(mode='after')
    def coherent(self):
        if (not self.question.strip() or not self.expected_answer.strip()
                or (self.expected_status == 'SUPPORTED') != bool(self.expected_facts)
                or len({f.id for f in self.expected_facts}) != len(self.expected_facts)
                or len(set(self.expected_source_ids)) != len(self.expected_source_ids)
                or len(set(self.tags)) != len(self.tags)
                or self.selected_source_ids is not None and len(set(self.selected_source_ids)) != len(self.selected_source_ids)):
            raise ValueError('Invalid evaluation case')
        labelled = {loc.source_id for fact in self.expected_facts for loc in fact.locations}
        if labelled != set(self.expected_source_ids):
            raise ValueError('Expected facts and sources differ')
        if self.selected_source_ids is not None and not labelled <= set(self.selected_source_ids):
            raise ValueError('Gold evidence outside selected scope')
        for pattern in self.forbidden_patterns:
            validate_pattern(pattern)
        return self


class SourceFixture(ContractModel):
    id: UUID
    workspace_fixture_id: UUID
    title: Identifier
    path: str = Field(min_length=1, max_length=255)
    source_type: Literal['PDF', 'DOCX', 'TXT', 'CSV', 'XLSX']
    sha256: Hash
    extraction_sha256: Hash


class Suite(ContractModel):
    schema_version: Literal['1.0']
    id: Identifier
    version: Identifier
    description: str = Field(min_length=1, max_length=4000)
    reference_chunking: ChunkingConfig
    sources: list[SourceFixture] = Field(min_length=1, max_length=100)
    cases: list[EvaluationCase] = Field(min_length=20, max_length=1000)

    @model_validator(mode='after')
    def scope(self):
        sources = {source.id: source for source in self.sources}
        if len(sources) != len(self.sources) or len({case.id for case in self.cases}) != len(self.cases):
            raise ValueError('Duplicate suite identities')
        workspaces = {s.workspace_fixture_id for s in self.sources}
        for case in self.cases:
            selected = case.expected_source_ids + (case.selected_source_ids or [])
            if case.workspace_fixture_id not in workspaces or any(
                    source not in sources or sources[source].workspace_fixture_id != case.workspace_fixture_id
                    for source in selected):
                raise ValueError('Fixture scope violation')
        return self


class Pricing(ContractModel):
    currency: Literal['USD', 'EUR', 'PLN']
    input_per_million: Nonnegative
    output_per_million: Nonnegative
    revision: Identifier


class RunConfig(ContractModel):
    name: Identifier
    top_k: StrictInt = Field(default=6, ge=1, le=12)
    repetitions: StrictInt = Field(default=1, ge=1, le=20)
    chunking: ChunkingConfig = Field(default_factory=ChunkingConfig)
    index: Literal['fixture-hybrid', 'fixture-lexical', 'fixture-vector', 'spring-hybrid'] = 'fixture-hybrid'
    template_id: Identifier = 'workspace-question:2'
    system_instruction: str = Field(min_length=1, max_length=4000)
    parameters: ModelParameters = Field(default_factory=lambda: ModelParameters(temperature=0, max_output_tokens=1024))
    pricing: Pricing | None = None
    revision: Identifier = 'working-tree'

    @model_validator(mode='after')
    def nonblank(self):
        if not self.system_instruction.strip():
            raise ValueError('Blank evaluation prompt')
        return self


class AnswerObservation(ContractModel):
    answer: StructuredAnswer
    # Actual model context, which can be smaller/different than retrieval search output.
    provided_chunks: list[RetrievalChunk] = Field(max_length=12)
    usage: UsageMetadata | None = None
    model: dict[str, str] = Field(default_factory=dict)
    template_id: Identifier
    template_hash: Hash
    latency_ms: Nonnegative


class JudgeSignal(ContractModel):
    """Explicitly imperfect supplemental signal, bound to the exact evaluated payload."""
    case_id: Identifier
    observation_hash: Hash
    model: Identifier
    rubric_version: Identifier
    score: Rate
    rationale: str = Field(min_length=1, max_length=2000)
    imperfect_supplemental: Literal[True] = True


class ClaimCheck(ContractModel):
    statement: str = Field(min_length=1, max_length=2000)
    supported_by_curated_rules: StrictBool
    rule: Literal['verbatim-cited-passage', 'curated-statement-and-span', 'no-curated-support']


class CaseMetrics(ContractModel):
    source_recall_at_k: Rate | None = None
    chunk_recall_at_k: Rate | None = None
    span_recall_at_k: Rate | None = None
    mrr_at_k: Rate | None = None
    source_hit_rate: Rate | None = None
    page_hit_rate: Rate | None = None
    citation_validity: Rate | None = None
    expected_source_coverage: Rate | None = None
    fact_coverage: Rate | None = None
    answer_correctness: Rate
    unsupported_claim_rate: Rate | None = None
    status_correct: Rate
    returned_chunks: StrictInt = Field(ge=0, le=12)
    retrieval_latency_ms: Nonnegative | None = None
    answer_latency_ms: Nonnegative | None = None
    input_tokens: StrictInt | None = Field(default=None, ge=0)
    output_tokens: StrictInt | None = Field(default=None, ge=0)
    total_tokens: StrictInt | None = Field(default=None, ge=0)
    usage_estimated: StrictBool | None = None
    estimated_cost: Nonnegative | None = None
    unsupported_statements: StrictInt | None = Field(default=None, ge=0)
    assessed_statements: StrictInt | None = Field(default=None, ge=0)
    invalid_citations: StrictInt | None = Field(default=None, ge=0)
    forbidden_answer: StrictBool | None = None
    matched_facts: list[Identifier] = Field(default_factory=list)
    claim_checks: list[ClaimCheck] = Field(default_factory=list)


class CaseError(ContractModel):
    stage: Literal['retrieval', 'answer']
    code: Annotated[str, Field(pattern=r'^[A-Z][A-Z0-9_]{0,63}$')]


class RetrievalDiagnostic(ContractModel):
    rank: StrictInt = Field(ge=1, le=12)
    chunk_id: Hash
    score: float = Field(allow_inf_nan=False)
    vector_similarity: float | None = Field(default=None, ge=-1.000001, le=1.000001, allow_inf_nan=False)
    lexical_score: Nonnegative | None = None
    embedding_model: EmbeddingModelMetadata


class CaseResult(ContractModel):
    case_id: Identifier
    repetition: StrictInt = Field(ge=0, le=19)
    tags: list[Identifier]
    difficulty: Literal['easy', 'medium', 'hard']
    error: CaseError | None
    retrieved_chunks: list[RetrievalChunk] = Field(max_length=12)
    retrieval_diagnostics: list[RetrievalDiagnostic] = Field(default_factory=list, max_length=12)
    answer: AnswerObservation | None
    supplemental_judge: JudgeSignal | None
    metrics: CaseMetrics


class RunManifest(ContractModel):
    suite_id: Identifier
    suite_version: Identifier
    suite_hash: Hash
    corpus_hash: Hash
    scoring_version: Identifier
    python: Identifier
    config: RunConfig
    backend: dict[str, Any]


class RunReport(ContractModel):
    schema_version: Literal['1.0']
    run_fingerprint: Hash
    manifest: RunManifest
    summary: dict[str, Any]
    groups: dict[str, Any]
    cases: list[CaseResult] = Field(min_length=20, max_length=20000)
