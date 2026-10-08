import json
from pathlib import Path
from unittest.mock import Mock

import pytest

from researchhub_worker.ai.contracts import Claim, StructuredAnswer, UsageMetadata
from researchhub_worker.ai.providers import FakeModelProvider, ModelGateway, ProviderError
from researchhub_worker.evaluation import models
from researchhub_worker.evaluation.__main__ import main
from researchhub_worker.evaluation.contracts import Pricing
from researchhub_worker.evaluation.offline import OfflineBackend
from researchhub_worker.evaluation.runner import run

ROOT = Path(__file__).resolve().parents[3]
MATRIX = ROOT / 'docs/evaluation/models/demo-matrix.json'


def matrix():
    return models.Matrix.model_validate_json(MATRIX.read_text())


def test_matrix_contract_and_secret_names_not_values():
    value = matrix()
    assert value.preferred_candidate == 'gemini-3-8-flash' and len(value.candidates) >= 4
    assert value.thresholds.injection_pass_rate == 1
    schema = models.Matrix.model_json_schema(by_alias=True)
    assert 'candidates' in schema['properties']
    assert schema == {k:v for k,v in json.loads((ROOT/'docs/evaluation/schemas/model-matrix.schema.json').read_text()).items() if k != '$schema'}
    with pytest.raises(ValueError):
        models.Matrix.model_validate(value.model_copy(update={'candidates':value.candidates*2}).model_dump())
    with pytest.raises(ValueError):
        models.Matrix.model_validate(value.model_copy(update={'preferred_candidate':'missing'}).model_dump())


@pytest.mark.parametrize('updates', [dict(base_url=None), dict(api_key_env=None), dict(base_url='http://host'),
    dict(api_key_env='actual-secret-value'), dict(version=''), dict(provider='unknown')])
def test_compatible_matrix_validation(updates):
    value = matrix().candidates[1].model_dump()
    value.update(updates)
    with pytest.raises(ValueError):
        models.Candidate.model_validate(value)


def test_foundry_and_deterministic_contracts_fail_closed():
    for index, key, value in [(0,'model','other'), (4,'deployment_env',None)]:
        candidate = matrix().candidates[index].model_dump()
        candidate[key] = value
        with pytest.raises(ValueError):
            models.Candidate.model_validate(candidate)


def test_factory_requires_access_and_selects_real_adapters(monkeypatch):
    for candidate in matrix().candidates:
        for name in (candidate.api_key_env, candidate.deployment_env, candidate.endpoint_env, candidate.model_env, candidate.version_env):
            if name:
                monkeypatch.delenv(name, raising=False)
    assert models.gateway(matrix().candidates[0]).model_metadata().provider == 'deterministic'
    assert models.gateway(matrix().candidates[1]) is None
    assert models.gateway(matrix().candidates[4]) is None
    monkeypatch.setenv('RH_LOCAL_MODEL_KEY','private-key')
    assert models.gateway(matrix().candidates[1]).model_metadata().name.startswith('qwen3:')
    for suffix,value in dict(API_KEY='private-key',ENDPOINT='https://foundry.invalid',DEPLOYMENT='deployment',MODEL='real-model',MODEL_VERSION='revision').items():
        monkeypatch.setenv('FOUNDRY_'+suffix,value)
    assert models.gateway(matrix().candidates[4]).model_metadata().provider == 'foundry'


def test_security_fixture_is_same_reviewed_contract_and_maintains_scope(loaded, config):
    fixture = (models.Path(models.__file__).parent / 'fixtures/prompt-injection.json').read_bytes()
    assert fixture == (ROOT / 'contracts/ai/security/prompt-injection.json').read_bytes()
    fixture = json.loads(fixture)
    request = models.security_request(loaded,config,fixture)
    assert request.blocks()[0].title == fixture['sourceTitle']
    assert fixture['unrelatedWorkspaceText'] not in request.model_dump_json()
    assert len(request.request.evidence) == 1
    rows = models.security(loaded,config,ModelGateway(FakeModelProvider()),fixture)
    assert [r['passed'] for r in rows] == [False,True]
    assert all(r['schemaValid'] for r in rows)


@pytest.mark.parametrize('bad', [False, True])
def test_security_counts_provider_failure_and_preserves_billed_usage(loaded, config, bad):
    fixture = json.loads((models.Path(models.__file__).parent / 'fixtures/prompt-injection.json').read_text())
    provider = FakeModelProvider()
    if bad:
        def fail(request):
            from researchhub_worker.ai.telemetry import record_payload
            record_payload(provider.model_metadata(), {'usage':{'prompt_tokens':2,'completion_tokens':3,'total_tokens':5}})
            raise ProviderError('AI_OUTPUT_INVALID')
        provider.generate_structured = fail
    else:
        original = provider.generate_structured
        def good(request):
            result = original(request)
            answer = StructuredAnswer(status='INSUFFICIENT_EVIDENCE',claims=[]) if 'zebra' in request.request.instruction else StructuredAnswer(
                status='SUPPORTED',claims=[Claim(text='The contact resistance was 0.3 ohm.',evidence_ids=[request.request.evidence[0].chunk_id])])
            return result.model_copy(update={'answer':answer})
        provider.generate_structured = good
    priced = config.model_copy(update={'pricing':Pricing(currency='USD',input_per_million=1,output_per_million=2,revision='test')})
    rows = models.security(loaded,priced,ModelGateway(provider),fixture)
    assert all(r['passed'] == (not bad) for r in rows)
    assert all(r['usage'] is not None and r['costUsd'] is not None for r in rows)
    if bad:
        assert rows[0]['error'] == 'AI_OUTPUT_INVALID' and not rows[0]['schemaValid']


def test_scores_unknown_cost_and_missing_thresholds_are_not_passing(loaded,config):
    report = run(loaded,config,OfflineBackend(loaded,config))
    fixture=json.loads((models.Path(models.__file__).parent/'fixtures/prompt-injection.json').read_text())
    rows=models.security(loaded,config,ModelGateway(FakeModelProvider()),fixture)
    metrics=models.score(loaded,report,rows)
    assert metrics['observations']==35 and metrics['meanCostUsd'] is None
    assert metrics['schemaValidOutputRate']==1 and metrics['correctRefusalRate']<1
    misses=models.assess(metrics,models.Thresholds())
    assert 'meanCostUsd' in misses and 'injectionPassRate' in misses
    metrics.update({k:1 for k in models.Thresholds().model_dump(by_alias=True)})
    metrics.update(p95LatencyMs=8000,meanCostUsd=.01)
    assert models.assess(metrics,models.Thresholds())==[]
    metrics.update(p95LatencyMs=8001)
    assert models.assess(metrics,models.Thresholds())==['p95LatencyMs']


def test_report_runs_full_suite_and_marks_unavailable_models(loaded,config,tmp_path):
    result=models.evaluate(loaded,config,matrix(),tmp_path,factory=lambda c: ModelGateway(FakeModelProvider()) if c.id=='deterministic' else None)
    assert len(result['results'])==5 and result['results'][1]['status']=='unavailable'
    assert len(json.loads((tmp_path/'deterministic.json').read_text())['cases'])==33
    assert result['results'][0]['metrics']['meanCostUsd']==0
    assert 'required-worker-environment-not-configured' in (tmp_path/'models.md').read_text()
    assert 'private-key' not in json.dumps(result)
    assert json.loads((tmp_path/'models.json').read_text())==result


def test_accepted_model_and_all_failed_models_render(loaded,config,tmp_path,monkeypatch):
    monkeypatch.setattr(models,'assess',lambda *args:[])
    result=models.evaluate(loaded,config,matrix(),tmp_path,factory=lambda c:ModelGateway(FakeModelProvider()))
    assert all(r['accepted'] for r in result['results']) and 'PASS' in models.table(result)
    result['results'][0]['metrics']['meanCostUsd']=None
    assert 'unknown' in models.table(result)


def test_rejects_incomparable_index_and_prices(loaded,config,tmp_path):
    for update in (dict(index='fixture-vector'),dict(pricing=Pricing(currency='USD',input_per_million=0,output_per_million=0,revision='test'))):
        with pytest.raises(ValueError):
            models.evaluate(loaded,config.model_copy(update=update),matrix(),tmp_path)
    value=matrix()
    value.candidates[0]=value.candidates[0].model_copy(update={'pricing':value.candidates[0].pricing.model_copy(update={'currency':'EUR'})})
    with pytest.raises(ValueError):
        models.evaluate(loaded,config,value,tmp_path)


def test_single_command_and_safe_bad_matrix(tmp_path,monkeypatch):
    monkeypatch.setattr(models,'gateway',Mock())
    called=[]
    def evaluate(*args):
        called.append(args)
        return {'preferredAccepted':True}
    monkeypatch.setattr(models,'evaluate',evaluate)
    assert main(['models','--matrix',str(MATRIX),'--output',str(tmp_path)])==0
    assert len(called)==1
    monkeypatch.setattr(models,'evaluate',lambda *args:{'preferredAccepted':False})
    assert main(['models','--matrix',str(MATRIX),'--output',str(tmp_path)])==1
    invalid=tmp_path/'bad.json';invalid.write_text('{')
    assert main(['models','--matrix',str(invalid),'--output',str(tmp_path)])==2


def test_failure_usage_and_latency_remain_in_runner(loaded,config):
    backend=OfflineBackend(loaded,config)
    def fail(*args):
        error=ProviderError('AI_OUTPUT_INVALID');error.telemetry={'usage':{'inputTokens':2,'outputTokens':3,'totalTokens':5,'estimated':False}}
        raise error
    backend.answer=fail
    report=run(loaded,config,backend)
    assert report['summary']['totalTokens']['total']==165
    assert report['summary']['answerLatencyMs']['measured']==33
