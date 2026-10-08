from copy import deepcopy
import json

import pytest

from researchhub_worker.ai.providers import ProviderError
from researchhub_worker.evaluation.__main__ import main, FIXTURES
from researchhub_worker.evaluation.contracts import RunConfig, JudgeSignal
from researchhub_worker.evaluation.metrics import observation_hash
from researchhub_worker.evaluation.offline import OfflineBackend
from researchhub_worker.evaluation.report import compare, markdown, comparison_markdown, write_json
from researchhub_worker.evaluation.runner import run


def fixed_clock():
    counter = iter(range(100000))
    return lambda: next(counter) / 1000


def test_offline_e2e_is_reproducible_and_reports_every_case_and_group(loaded, config):
    baseline = run(loaded, config, OfflineBackend(loaded, config), clock=fixed_clock())
    repeat = run(loaded, config, OfflineBackend(loaded, config), clock=fixed_clock())
    assert baseline == repeat
    assert len(baseline['cases']) == len(loaded.suite.cases)
    assert baseline['summary']['failures'] == 0
    assert baseline['summary']['spanRecallAtK']['eligible'] >= 20
    assert baseline['groups']['tag:comparison']['observations'] == 2
    assert 'difficulty:hard' in baseline['groups']
    text = markdown(baseline)
    assert 'n/a' in text and 'estimatedCost' in text and 'not a general semantic proof' in text
    assert 'secret token' not in baseline['manifest']


@pytest.mark.parametrize('index', ['fixture-lexical', 'fixture-vector', 'fixture-hybrid'])
def test_fixture_index_variants_are_comparable_with_explicit_identity(loaded, config, index):
    candidate = config.model_copy(update={'index': index, 'repetitions': 2})
    backend = OfflineBackend(loaded, candidate)
    report = run(loaded, candidate, backend, clock=fixed_clock())
    assert len(report['cases']) == len(loaded.suite.cases)*2
    assert report['manifest']['backend']['productionIndex'] is False
    assert report['summary']['failures'] == 0


def test_source_selection_empty_scope_and_foreign_workspace_are_enforced(loaded, config):
    backend = OfflineBackend(loaded, config)
    for case in loaded.suite.cases:
        chunks = backend.retrieve(case)
        assert all(c.workspace_id == case.workspace_fixture_id for c in chunks)
        assert all(case.selected_source_ids is None or c.source_id in case.selected_source_ids for c in chunks)
    case = next(c for c in loaded.suite.cases if c.id == 'empty-scope')
    assert backend.retrieve(case) == []
    with pytest.raises(ValueError):
        OfflineBackend(loaded, config.model_copy(update={'index': 'spring-hybrid'}))


def test_mismatched_rank_diagnostics_cannot_be_accepted(loaded, config):
    backend = OfflineBackend(loaded, config)
    backend.retrieval_diagnostics = lambda: []
    report = run(loaded, config, backend)
    assert report['cases'][0]['error'] is not None


@pytest.mark.parametrize('failure_stage', ['retrieval', 'answer'])
def test_failed_cases_are_retained_without_exception_payloads(loaded, config, failure_stage):
    backend = OfflineBackend(loaded, config)
    def fail(*args):
        raise ProviderError('AI_REFUSED') if failure_stage == 'answer' else ValueError('secret credentials')
    setattr(backend, 'retrieve' if failure_stage == 'retrieval' else 'answer', fail)
    report = run(loaded, config, backend, clock=fixed_clock())
    assert report['summary']['failures'] == len(loaded.suite.cases)
    assert report['summary']['answerCorrectness']['value'] == 0
    assert 'secret credentials' not in json.dumps(report)
    assert report['cases'][0]['error']['stage'] == failure_stage
    assert report['summary']['citationValidity']['eligible'] >= 20


@pytest.mark.parametrize('violation', ['foreign', 'duplicate', 'too-many', 'forged-content'])
def test_runner_rejects_adapter_scope_violations(loaded, config, violation):
    backend = OfflineBackend(loaded, config)
    original = backend.retrieve
    foreign = next(c for c in backend.chunks if c.workspace_id != loaded.suite.cases[0].workspace_fixture_id)
    def malformed(case):
        chunks = original(case)
        if violation == 'forged-content' and chunks:
            from researchhub_worker.retrieval.contracts import digest
            forged = chunks[0].model_copy(update={'content': 'Forged answer', 'content_hash': digest('Forged answer')})
            return [forged]
        return [foreign] if violation == 'foreign' else chunks*2 if chunks else [foreign]
    if violation == 'too-many':
        backend.retrieve = lambda case: backend.chunks[:13]
    else:
        backend.retrieve = malformed
    report = run(loaded, config, backend)
    assert report['cases'][0]['error'] is not None


def test_explicit_judge_is_hash_bound_and_never_changes_deterministic_metrics(loaded, config):
    backend = OfflineBackend(loaded, config)
    case = loaded.suite.cases[0]
    observation = backend.answer(case, backend.retrieve(case))
    signal = JudgeSignal(case_id=case.id, observation_hash=observation_hash(case, observation),
        model='external-judge:revision-1', rubric_version='support:1', score=0.2, rationale='Imperfect supplemental review.')
    baseline = run(loaded, config, backend, clock=fixed_clock())
    judged = run(loaded, config, backend, clock=fixed_clock(), judge_signals=[signal])
    assert baseline['summary'] == judged['summary']
    assert judged['cases'][0]['supplementalJudge']['imperfectSupplemental'] is True
    mismatch = signal.model_copy(update={'observation_hash': '0'*64})
    with pytest.raises(ValueError):
        run(loaded, config, backend, judge_signals=[mismatch])
    for signals in ([signal, signal], [signal.model_copy(update={'case_id': 'missing'})]):
        with pytest.raises(ValueError):
            run(loaded, config, backend, judge_signals=signals)


def test_comparison_detects_quality_changes_and_incompatible_chunk_denominators(loaded, config):
    baseline = run(loaded, config, OfflineBackend(loaded, config), clock=fixed_clock())
    candidate_config = RunConfig.model_validate_json((FIXTURES / 'small-chunks.json').read_text())
    candidate = run(loaded, candidate_config, OfflineBackend(loaded, candidate_config), clock=fixed_clock())
    comparison = compare(baseline, candidate)
    assert comparison['changes']['chunkRecallAtK']['comparable'] is False
    assert comparison['changes']['chunkRecallAtK']['delta'] is None
    assert 'spanRecallAtK' in comparison['changes']
    assert len(comparison['cases']) == len(loaded.suite.cases)
    assert 'Direction' in comparison_markdown(comparison)
    assert compare(baseline, baseline)['passed']
    assert compare(baseline, candidate, max_quality_drop=1)['passed']


@pytest.mark.parametrize('mutation', [
    lambda p: p.update(schemaVersion='99'),
    lambda p: p['manifest'].update(suiteHash='0'*64),
    lambda p: p['manifest'].update(corpusHash='0'*64),
    lambda p: p['manifest'].update(scoringVersion='changed'),
    lambda p: p['cases'].reverse(),
    lambda p: p['cases'].pop(),
    lambda p: p['summary'].update(failures=99),
    lambda p: p['manifest']['config'].update(pricing={'currency':'USD','inputPerMillion':1,'outputPerMillion':1,'revision':'1'}),
])
def test_comparison_refuses_mismatched_corpus_case_set_and_rates(loaded, config, mutation):
    baseline = run(loaded, config, OfflineBackend(loaded, config), clock=fixed_clock())
    candidate = deepcopy(baseline)
    mutation(candidate)
    with pytest.raises(ValueError):
        compare(baseline, candidate)


def test_comparison_failure_gate_and_invalid_tolerance(loaded, config):
    baseline = run(loaded, config, OfflineBackend(loaded, config), clock=fixed_clock())
    backend = OfflineBackend(loaded, config)
    backend.answer = lambda *args: (_ for _ in ()).throw(RuntimeError())
    candidate = run(loaded, config, backend, clock=fixed_clock())
    assert 'failures' in compare(baseline, candidate)['regressions']
    with pytest.raises(ValueError):
        compare(baseline, candidate, max_quality_drop=-1)


def test_report_numeric_validation_and_manifest_integrity_prevent_false_passes(loaded, config):
    baseline = run(loaded, config, OfflineBackend(loaded, config), clock=fixed_clock())
    candidate = deepcopy(baseline)
    candidate['runFingerprint'] = '0'*64
    with pytest.raises(ValueError):
        compare(baseline, candidate)
    candidate = deepcopy(baseline)
    candidate['cases'][0]['metrics']['answerCorrectness'] = float('nan')
    with pytest.raises(ValueError):
        compare(baseline, candidate)


def test_invalid_supplemental_cli_input_cannot_publish_a_report(loaded, config, tmp_path):
    backend = OfflineBackend(loaded, config)
    case = loaded.suite.cases[0]
    signal = {'caseId': case.id, 'observationHash': '0'*64, 'model': 'judge-v1',
        'rubricVersion': '1', 'score': 1, 'rationale': 'Stale judgment.', 'imperfectSupplemental': True}
    signals = tmp_path / 'judge.json'
    signals.write_text(json.dumps([signal]))
    report = tmp_path / 'rejected.json'
    assert main(['run', '--judge-signals', str(signals), '--output', str(report)]) == 2
    assert not report.exists()


def test_cli_run_compare_errors_and_output_are_reviewable(tmp_path, capsys):
    output = tmp_path / 'baseline.json'
    assert main(['run', '--output', str(output)]) == 0
    assert output.exists() and output.with_suffix('.md').exists()
    assert output.stat().st_mode & 0o777 == 0o600
    comparison = tmp_path / 'comparison.json'
    assert main(['compare', str(output), str(output), '--output', str(comparison)]) == 0
    assert json.loads(comparison.read_text())['passed']
    candidate = tmp_path / 'candidate.json'
    assert main(['run', '--config', str(FIXTURES / 'small-chunks.json'), '--output', str(candidate)]) == 0
    assert main(['compare', str(output), str(candidate), '--output', str(comparison)]) == 1
    assert main(['run', '--config', str(tmp_path / 'missing'), '--output', str(output)]) == 2
    assert main(['run', '--mode', 'spring', '--output', str(output)]) == 2
    assert 'No report accepted' in capsys.readouterr().out
