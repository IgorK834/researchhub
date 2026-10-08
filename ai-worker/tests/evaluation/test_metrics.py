from uuid import uuid4
import pytest

from researchhub_worker.ai.contracts import StructuredAnswer, Claim, UsageMetadata
from researchhub_worker.evaluation.contracts import AnswerObservation, Pricing
from researchhub_worker.evaluation.metrics import (retrieval_metrics, answer_metrics, covered_by, cost,
    percentile, aggregate, observation_hash)
from researchhub_worker.evaluation.offline import OfflineBackend
from researchhub_worker.retrieval.contracts import SourceSpan, digest


def test_retrieval_metrics_deduplicate_sources_and_use_rank_with_pages_and_spans(loaded, config):
    case = loaded.suite.cases[0]
    chunks = loaded.chunks(config.chunking)
    gold = case.expected_facts[0].locations[0]
    correct = next(c for c in chunks if covered_by([c], gold))
    wrong_page = next(c for c in chunks if c.source_id == gold.source_id and c.page_start != gold.page)
    result = retrieval_metrics(case, [wrong_page, correct, correct], 3)
    assert result['sourceRecallAtK'] == 1
    assert result['mrrAtK'] == 0.5
    assert result['spanRecallAtK'] == result['chunkRecallAtK'] == result['pageHitRate'] == 1
    assert retrieval_metrics(case, [wrong_page], 1)['mrrAtK'] == 0
    assert retrieval_metrics(case, [correct], 1, exact_chunks=False)['chunkRecallAtK'] is None
    assert retrieval_metrics(case, [], 2)['spanRecallAtK'] == 0


def test_unknown_pages_and_unanswerable_cases_do_not_fabricate_denominators(loaded, config):
    case = next(c for c in loaded.suite.cases if c.id == 'missing-atlantis')
    values = retrieval_metrics(case, [], 6)
    assert all(values[k] is None for k in ('sourceRecallAtK', 'mrrAtK', 'pageHitRate', 'spanRecallAtK'))
    docx_case = next(c for c in loaded.suite.cases if c.id == 'protocol-sampling')
    assert retrieval_metrics(docx_case, [], 6)['pageHitRate'] is None


def test_full_span_can_be_covered_by_several_chunks_but_gaps_fail(loaded, config):
    case = loaded.suite.cases[0]
    location = case.expected_facts[0].locations[0]
    chunk = next(c for c in loaded.chunks(config.chunking) if covered_by([c], location))
    midpoint = (location.character_start + location.character_end)//2
    def partial(start, end):
        return chunk.model_copy(update={'spans': [SourceSpan(unit_id=location.unit_id, character_start=start, character_end=end)]})
    first, last = partial(location.character_start, midpoint), partial(midpoint, location.character_end)
    assert covered_by([last, first], location)
    assert not covered_by([first, partial(midpoint+1, location.character_end)], location)
    assert not covered_by([chunk.model_copy(update={'source_id': uuid4()})], location)


def observation(case, chunks, config, claims, status='SUPPORTED'):
    return AnswerObservation(answer=StructuredAnswer(status=status, claims=claims), provided_chunks=chunks,
        template_id=config.template_id, template_hash=digest(config.system_instruction), latency_ms=0)


def test_invented_citations_are_invalid_even_if_the_answer_contains_expected_fact(loaded, config):
    case = loaded.suite.cases[0]
    backend = OfflineBackend(loaded, config)
    result = observation(case, backend.retrieve(case), config,
        [Claim(text=case.expected_answer, evidence_ids=['f'*64])])
    metrics = answer_metrics(case, result)
    assert metrics['citationValidity'] == metrics['expectedSourceCoverage'] == 0
    assert metrics['invalidCitations'] == 1
    assert metrics['unsupportedClaimRate'] == 1


def test_curated_paraphrase_requires_correct_cited_span_and_extra_claim_is_detected(loaded, config):
    case = loaded.suite.cases[0]
    backend = OfflineBackend(loaded, config)
    chunks = backend.retrieve(case)
    correct = next(c for c in chunks if covered_by([c], case.expected_facts[0].locations[0]))
    result = observation(case, chunks, config, [Claim(text=case.expected_answer + ' The Moon is made of cheese.', evidence_ids=[correct.chunk_id])])
    metrics = answer_metrics(case, result)
    assert metrics['factCoverage'] == 1
    assert metrics['assessedStatements'] == 2
    assert metrics['unsupportedClaimRate'] == 0.5
    wrong = next(c for c in chunks if c.chunk_id != correct.chunk_id)
    result = observation(case, chunks, config, [Claim(text=case.expected_answer, evidence_ids=[wrong.chunk_id])])
    assert answer_metrics(case, result)['unsupportedClaimRate'] == 1


def test_negation_forbidden_values_and_insufficiency_are_scored(loaded, config):
    case = loaded.suite.cases[0].model_copy(update={'forbidden_patterns': ['not 4.7 seconds']})
    chunks = OfflineBackend(loaded, config).retrieve(case)
    claim = Claim(text='The nominal time constant is not 4.7 seconds.', evidence_ids=[chunks[0].chunk_id])
    metrics = answer_metrics(case, observation(case, chunks, config, [claim]))
    assert metrics['answerCorrectness'] == 0 and metrics['forbiddenAnswer']
    assert metrics['unsupportedClaimRate'] == 1
    empty = next(c for c in loaded.suite.cases if c.id == 'empty-scope')
    metrics = answer_metrics(empty, observation(empty, [], config, [], 'INSUFFICIENT_EVIDENCE'))
    assert metrics['answerCorrectness'] == 1
    assert metrics['citationValidity'] is None and metrics['unsupportedClaimRate'] is None


def test_actual_context_not_full_retrieval_determines_valid_citations(loaded, config):
    case = loaded.suite.cases[0]
    chunks = OfflineBackend(loaded, config).retrieve(case)
    removed = chunks[0]
    result = observation(case, chunks[1:], config, [Claim(text=removed.content, evidence_ids=[removed.chunk_id])])
    assert answer_metrics(case, result)['citationValidity'] == 0


def test_reviewed_nonverbatim_statement_requires_its_curated_gold_span(loaded, config):
    original = loaded.suite.cases[0]
    fact = original.expected_facts[0].model_copy(update={'supported_statements': [r'rc nominal tau is 4\.7 s\.']})
    case = original.model_copy(update={'expected_facts': [fact]})
    chunks = OfflineBackend(loaded, config).retrieve(case)
    correct = next(c for c in chunks if covered_by([c], fact.locations[0]))
    answer = observation(case, chunks, config, [Claim(text='RC nominal tau is 4.7 s.', evidence_ids=[correct.chunk_id])])
    checks = answer_metrics(case, answer)['claimChecks']
    assert checks == [{'statement':'RC nominal tau is 4.7 s.', 'supportedByCuratedRules':True, 'rule':'curated-statement-and-span'}]


def test_usage_pricing_and_nearest_rank_percentiles_do_not_invent_cost():
    usage = UsageMetadata(input_tokens=1000, output_tokens=250, total_tokens=1250, estimated=False)
    pricing = Pricing(currency='USD', input_per_million=2, output_per_million=8, revision='test-rates')
    assert cost(usage, pricing) == pytest.approx(0.004)
    assert cost(usage, None) is None and cost(None, pricing) is None
    assert percentile([], 0.95) is None
    assert percentile(list(range(1, 21)), 0.95) == 19
    assert percentile([1, 2, 3, 4], 0.5) == 2


def test_aggregates_expose_denominators_and_missing_measurements():
    rows = [{'error': None, 'metrics': {'answerCorrectness': 1, 'retrievalLatencyMs': 2, 'inputTokens': 3}},
        {'error': {'code': 'FAILED'}, 'metrics': {'answerCorrectness': 0, 'retrievalLatencyMs': 4}}]
    summary = aggregate(rows)
    assert summary['answerCorrectness'] == {'value': 0.5, 'eligible': 2}
    assert summary['failures'] == 1
    assert summary['retrievalLatencyMs']['p95'] == 4
    assert summary['estimatedCost'] == {'total': None, 'measured': 0}


def test_judge_fingerprint_includes_evidence_and_answer_but_not_clock(loaded, config):
    case = loaded.suite.cases[0]
    backend = OfflineBackend(loaded, config)
    result = backend.answer(case, backend.retrieve(case))
    assert observation_hash(case, result) == observation_hash(case, result.model_copy(update={'latency_ms': 999}))
    assert observation_hash(case, result) != observation_hash(case.model_copy(update={'question': 'Different'}), result)
