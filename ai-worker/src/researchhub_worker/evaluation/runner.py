"""Adapter-based runner. Failures remain visible and count against quality."""
import platform
import time
from typing import Protocol

from ..ai.providers import ProviderError
from ..ai.contracts import UsageMetadata
from ..retrieval.contracts import RetrievalChunk, identity_digest
from . import SCORING_VERSION
from .contracts import AnswerObservation, JudgeSignal, RetrievalDiagnostic
from .metrics import aggregate, answer_metrics, cost, observation_hash, retrieval_metrics


class EvaluationBackend(Protocol):
    def metadata(self) -> dict: ...
    def retrieve(self, case) -> list[RetrievalChunk]: ...
    def answer(self, case, chunks) -> AnswerObservation: ...


def validate_scope(case, chunks, maximum, allowed_sources, corpus_chunks):
    chunks = [RetrievalChunk.model_validate(c.model_dump()) for c in chunks]
    if len(chunks) > maximum or len({c.chunk_id for c in chunks}) != len(chunks) or any(
            corpus_chunks.get(c.chunk_id) != c or c.source_id not in allowed_sources or c.workspace_id != case.workspace_fixture_id or case.selected_source_ids is not None
            and c.source_id not in case.selected_source_ids for c in chunks):
        raise ValueError('Evaluation adapter violated workspace/source scope')
    return chunks


def run(loaded, config, backend: EvaluationBackend, clock=time.perf_counter, judge_signals=()):
    metadata = backend.metadata()
    corpus_chunks = {c.chunk_id: c for c in loaded.chunks(config.chunking)}
    manifest = {'suiteId': loaded.suite.id, 'suiteVersion': loaded.suite.version,
        'suiteHash': loaded.suite_hash, 'corpusHash': loaded.corpus_hash, 'scoringVersion': SCORING_VERSION,
        'python': platform.python_version(), 'config': config.model_dump(mode='json', by_alias=True), 'backend': metadata}
    signals = {s.case_id: s for s in judge_signals}
    if len(signals) != len(judge_signals) or not set(signals) <= {c.id for c in loaded.suite.cases}:
        raise ValueError('Duplicate or unknown supplemental judge cases')
    rows = []
    for case in loaded.suite.cases:
        allowed_sources = {s.id for s in loaded.suite.sources if s.workspace_fixture_id == case.workspace_fixture_id}
        for repetition in range(config.repetitions):
            row = {'caseId': case.id, 'repetition': repetition, 'tags': case.tags, 'difficulty': case.difficulty,
                'error': None, 'retrievedChunks': [], 'answer': None, 'supplementalJudge': None, 'metrics': {}}
            start = clock()
            stage = 'retrieval'
            try:
                chunks = validate_scope(case, backend.retrieve(case), config.top_k, allowed_sources, corpus_chunks)
                row['metrics']['retrievalLatencyMs'] = max(0, (clock() - start) * 1000)
                row['retrievedChunks'] = [c.model_dump(mode='json', by_alias=True) for c in chunks]
                diagnostics = getattr(backend, 'retrieval_diagnostics', None)
                if diagnostics is not None:
                    detail = [RetrievalDiagnostic.model_validate(d.model_dump()) for d in diagnostics()]
                    if [d.chunk_id for d in detail] != [c.chunk_id for c in chunks]:
                        raise ValueError('Retrieval diagnostics differ from ranked chunks')
                    row['retrievalDiagnostics'] = [d.model_dump(mode='json', by_alias=True) for d in detail]
                row['metrics'].update(retrieval_metrics(case, chunks, config.top_k,
                    exact_chunks=config.chunking == loaded.suite.reference_chunking))
                stage, start = 'answer', clock()
                observation = backend.answer(case, chunks)
                observation = AnswerObservation.model_validate(observation.model_dump())
                validate_scope(case, observation.provided_chunks, 12, allowed_sources, corpus_chunks)
                row['metrics']['answerLatencyMs'] = max(0, (clock() - start) * 1000)
                observation = observation.model_copy(update={'latency_ms': row['metrics']['answerLatencyMs']})
                row['answer'] = observation.model_dump(mode='json', by_alias=True)
                row['metrics'].update(answer_metrics(case, observation))
                row['metrics'].update({'inputTokens': observation.usage.input_tokens if observation.usage else None,
                    'outputTokens': observation.usage.output_tokens if observation.usage else None,
                    'totalTokens': observation.usage.total_tokens if observation.usage else None,
                    'usageEstimated': observation.usage.estimated if observation.usage else None,
                    'estimatedCost': cost(observation.usage, config.pricing)})
            except (ValueError, RuntimeError, OSError, KeyError, TypeError, AttributeError) as error:
                # No provider payloads, prompts, tokens or credentials in exception strings.
                row['error'] = {'stage': stage, 'code': error.code if isinstance(error, ProviderError) else 'EVALUATION_FAILED'}
                row['metrics']['answerLatencyMs' if stage == 'answer' else 'retrievalLatencyMs'] = max(0, (clock() - start) * 1000)
                telemetry = getattr(error, 'telemetry', None)
                if isinstance(telemetry, dict) and telemetry.get('usage') is not None:
                    usage = UsageMetadata.model_validate(telemetry['usage'])
                    row['metrics'].update({'inputTokens': usage.input_tokens, 'outputTokens': usage.output_tokens,
                        'totalTokens': usage.total_tokens, 'usageEstimated': usage.estimated, 'estimatedCost': cost(usage, config.pricing)})
                defaults = retrieval_metrics(case, [], config.top_k, config.chunking == loaded.suite.reference_chunking)
                for name, value in defaults.items():
                    row['metrics'].setdefault(name, value)
                row['metrics'].update({'answerCorrectness': 0.0, 'statusCorrect': 0.0,
                    'factCoverage': 0.0 if case.expected_facts else None,
                    'expectedSourceCoverage': 0.0 if case.expected_source_ids else None,
                    'citationValidity': 0.0 if case.expected_facts else None,
                    'unsupportedClaimRate': None})
            if case.id in signals:
                signal = JudgeSignal.model_validate(signals[case.id].model_dump())
                if row['error'] or signal.observation_hash != observation_hash(case, observation):
                    # Malformed supplemental inputs invalidate the run, never its deterministic scores.
                    raise ValueError('Supplemental judge input hash differs from observation')
                row['supplementalJudge'] = signal.model_dump(mode='json', by_alias=True)
            rows.append(row)
    verify_snapshot = getattr(backend, 'verify_snapshot', None)
    if verify_snapshot is not None:
        verify_snapshot()
    groups = {}
    for name in sorted({tag for c in loaded.suite.cases for tag in c.tags}):
        groups['tag:' + name] = aggregate([r for r in rows if name in r['tags']])
    for name in sorted({c.difficulty for c in loaded.suite.cases}):
        groups['difficulty:' + name] = aggregate([r for r in rows if r['difficulty'] == name])
    return {'schemaVersion': '1.0', 'runFingerprint': identity_digest([manifest]), 'manifest': manifest,
        'summary': aggregate(rows), 'groups': groups, 'cases': rows}
