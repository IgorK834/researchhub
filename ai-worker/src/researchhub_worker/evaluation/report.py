"""Machine-readable evidence and a reviewable paired Markdown comparison."""
import json
from pathlib import Path

from ..retrieval.contracts import identity_digest
from .contracts import RunReport
from .metrics import QUALITY_METRICS, aggregate


def write_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + '.tmp')
    temporary.write_text(json.dumps(value, indent=2, ensure_ascii=False, allow_nan=False) + '\n', encoding='utf-8')
    temporary.chmod(0o600)
    temporary.replace(path)


def number(value):
    return 'n/a' if value is None else f'{value:.4f}'


def markdown(report):
    manifest = report['manifest']
    lines = [f"# Evaluation: {manifest['config']['name']}", '',
        f"Suite `{manifest['suiteId']}:{manifest['suiteVersion']}`; corpus `{manifest['corpusHash']}`.",
        f"Index `{manifest['config']['index']}`; top-K {manifest['config']['topK']}; "
        f"scoring `{manifest['scoringVersion']}`; revision `{manifest['config']['revision']}`.", '',
        'Curated deterministic support checks are conservative signals, not a general semantic proof.',
        'Supplemental model judge scores are explicitly imperfect and never affect deterministic gates.', '',
        '| Metric | Value | Eligible |', '| --- | ---: | ---: |']
    for key in QUALITY_METRICS:
        item = report['summary'][key]
        lines.append(f"| {key} | {number(item['value'])} | {item['eligible']} |")
    lines.extend(['', f"Failures: {report['summary']['failures']} / {report['summary']['observations']}.", '',
        '| Timing | Mean ms | p50 ms | p95 ms | Measured |', '| --- | ---: | ---: | ---: | ---: |'])
    for key in ('retrievalLatencyMs', 'answerLatencyMs'):
        value = report['summary'][key]
        lines.append(f"| {key} | {number(value['mean'])} | {number(value['p50'])} | {number(value['p95'])} | {value['measured']} |")
    lines.extend(['', '| Usage | Total | Measured |', '| --- | ---: | ---: |'])
    for key in ('inputTokens', 'outputTokens', 'totalTokens', 'estimatedCost'):
        value = report['summary'][key]
        lines.append(f"| {key} | {number(value['total'])} | {value['measured']} |")
    pricing = manifest['config'].get('pricing')
    lines.extend(['', 'Cost: ' + (f"{pricing['currency']}, configured rate revision `{pricing['revision']}`." if pricing else
        'unavailable (no pinned pricing configured).'), '',
        '| Case | Correct | Span recall | Unsupported | Error |', '| --- | ---: | ---: | ---: | --- |'])
    for row in report['cases']:
        metrics = row['metrics']
        lines.append(f"| {row['caseId']} / {row['repetition']} | {number(metrics.get('answerCorrectness'))} | "
            f"{number(metrics.get('spanRecallAtK'))} | {number(metrics.get('unsupportedClaimRate'))} | "
            f"{row['error']['code'] if row['error'] else '-'} |")
    return '\n'.join(lines) + '\n'


def compare(baseline, candidate, max_quality_drop=0.0):
    if not 0 <= max_quality_drop <= 1:
        raise ValueError('Invalid regression tolerance')
    for report in (baseline, candidate):
        RunReport.model_validate(report)
        if report.get('schemaVersion') != '1.0' or report['summary'] != aggregate(report['cases']):
            raise ValueError('Invalid evaluation report or summary')
        if report['runFingerprint'] != identity_digest([report['manifest']]):
            raise ValueError('Evaluation report manifest fingerprint differs')
    for key in ('suiteHash', 'corpusHash', 'scoringVersion'):
        if baseline['manifest'][key] != candidate['manifest'][key]:
            raise ValueError('Comparison requires identical suite, corpus and scoring rules')
    def ids(report):
        return [(row['caseId'], row['repetition']) for row in report['cases']]
    if ids(baseline) != ids(candidate) or len(set(ids(baseline))) != len(ids(baseline)):
        raise ValueError('Comparison requires the same cases and repetitions in the same order')
    if baseline['manifest']['config'].get('pricing') != candidate['manifest']['config'].get('pricing'):
        raise ValueError('Comparison requires identical pricing; rerun with the same rates')
    changes, regressions = {}, []
    for key in QUALITY_METRICS:
        before, after = baseline['summary'][key], candidate['summary'][key]
        delta = after['value'] - before['value'] if before['value'] is not None and after['value'] is not None else None
        baseline_eligible = {(r['caseId'], r['repetition']) for r in baseline['cases'] if r['metrics'].get(key) is not None}
        candidate_eligible = {(r['caseId'], r['repetition']) for r in candidate['cases'] if r['metrics'].get(key) is not None}
        comparable = baseline_eligible == candidate_eligible and delta is not None
        changes[key] = {'baseline': before['value'], 'candidate': after['value'],
            'delta': delta if comparable else None, 'comparable': comparable,
            'higherIsBetter': key != 'unsupportedClaimRate'}
        if comparable and (delta if key != 'unsupportedClaimRate' else -delta) < -max_quality_drop - 1e-12:
            regressions.append(key)
    if candidate['summary']['failures'] > baseline['summary']['failures']:
        regressions.append('failures')
    # An unavailable metric is visible, never treated as an improvement or a zero.
    for key in ('retrievalLatencyMs', 'answerLatencyMs'):
        before, after = baseline['summary'][key]['p95'], candidate['summary'][key]['p95']
        changes[key + 'P95'] = {'baseline': before, 'candidate': after,
            'delta': after-before if before is not None and after is not None else None, 'higherIsBetter': False}
    for key in ('inputTokens', 'outputTokens', 'totalTokens', 'estimatedCost'):
        before, after = baseline['summary'][key]['total'], candidate['summary'][key]['total']
        changes[key] = {'baseline': before, 'candidate': after,
            'delta': after-before if before is not None and after is not None else None, 'higherIsBetter': False}
    paired = [{'caseId': before['caseId'], 'repetition': before['repetition'],
        'correctnessDelta': after['metrics']['answerCorrectness'] - before['metrics']['answerCorrectness'],
        'baselineError': before['error'], 'candidateError': after['error']}
        for before, after in zip(baseline['cases'], candidate['cases'])]
    return {'schemaVersion': '1.0', 'baseline': baseline['runFingerprint'], 'candidate': candidate['runFingerprint'],
        'changes': changes, 'regressions': regressions, 'passed': not regressions, 'cases': paired}


def comparison_markdown(comparison):
    lines = ['# Paired evaluation comparison', '',
        '| Metric | Baseline | Candidate | Delta | Direction |', '| --- | ---: | ---: | ---: | --- |']
    for key, value in comparison['changes'].items():
        lines.append(f"| {key} | {number(value['baseline'])} | {number(value['candidate'])} | "
            f"{number(value['delta'])} | {'higher' if value['higherIsBetter'] else 'lower'} |")
    lines.extend(['', 'Quality gate: ' + ('PASS' if comparison['passed'] else 'FAIL'),
        'Regressions: ' + (', '.join(comparison['regressions']) or 'none'), '',
        'n/a means unavailable or incompatible denominators; it is not a zero score.',
        'Latency and cost deltas are descriptive; quality gates do not approve production adoption.'])
    return '\n'.join(lines) + '\n'
