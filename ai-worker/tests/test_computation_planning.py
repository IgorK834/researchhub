import copy
import io
import json
from pathlib import Path
from unittest.mock import Mock
import pytest
from fastapi.testclient import TestClient
from researchhub_worker.analysis.contracts import PlanningRequest, Plan, Candidate, PLAN_SCHEMA
from researchhub_worker.ai.providers import FakeModelProvider, ModelGateway, ProviderError
from researchhub_worker.server import create_app
from test_ai import cloud, cloud_payload, AUTH, TOKEN

ROOT = Path('../contracts/analysis/computation-plan/v1')


def payload(name='request.json'):
    return json.loads((ROOT / name).read_text())


def request():
    return PlanningRequest.model_validate(payload())


def test_shared_schema_and_wire_fixtures_do_not_drift():
    for model, name in [(PlanningRequest, 'request'), (Plan, 'plan'), (Candidate, 'candidate')]:
        assert model.model_json_schema(by_alias=True) == payload(name + '.schema.json')
        model.model_validate(payload(name + '.json'))
    Plan.model_validate(payload('plan.json')).validate_for(request())


def test_offline_fixture_is_explicit_and_never_executes_generated_code():
    result = ModelGateway(FakeModelProvider()).plan_computation(request())
    assert result.model.provider == 'deterministic' and result.usage.estimated
    plan = Plan.model_validate_json(result.output)
    plan.validate_for(request())
    assert 'no computation' in plan.warnings[0]
    assert plan.code.source.startswith('raise RuntimeError')
    assert result.request_id == request().request.request_id


def test_cloud_requests_intent_schema_including_metadata_without_tools_or_credentials():
    body = cloud_payload()
    body['choices'][0]['message']['content'] = json.dumps(payload('plan.json'))
    provider, opener = cloud(json.dumps(body).encode())
    result = ModelGateway(provider).plan_computation(request())
    plan = Plan.model_validate_json(result.output)
    plan.validate_for(request())
    assert not result.usage.estimated
    sent = json.loads(opener.open.call_args.args[0].data)
    assert sent['response_format']['json_schema']['schema'] == PLAN_SCHEMA
    assert sent['response_format']['json_schema']['strict']
    assert sent['stream'] is False and sent['store'] is False and 'tools' not in sent
    assert 'private-test-key' not in json.dumps(sent)
    assert str(request().inputs[0].selection.source_version_id) in sent['messages'][1]['content']
    assert 'preview' in sent['messages'][1]['content']
    assert opener.open.call_count == 1  # Spring owns the total durable retry budget.


@pytest.mark.parametrize('mutate', [
    lambda p: p['inputs'][0].update(sourceVersionId='00000000-0000-4000-8000-000000000099'),
    lambda p: p['inputs'][0].update(sheetName='Private'),
    lambda p: p['inputs'][0].update(requiredColumns=[3]),
    lambda p: p['transformations'][0].update(columns=[3]),
    lambda p: p['transformations'][0].update(sheetName='Private'),
    lambda p: p['outputs'][0].update(sourceVersionIds=['00000000-0000-4000-8000-000000000099']),
    lambda p: p['inputs'].append(copy.deepcopy(p['inputs'][0])),
])
def test_unprovided_files_and_unselected_or_undeclared_references_are_rejected(mutate):
    plan = payload('plan.json'); mutate(plan)
    with pytest.raises(ValueError):
        Plan.model_validate(plan).validate_for(request())


@pytest.mark.parametrize('mutate', [
    lambda p: p.update(extra='no'),
    lambda p: p['inputs'][0].update(requiredColumns=[True]),
    lambda p: p['inputs'][0].update(requiredColumns=[1, 1]),
    lambda p: p['outputs'][0].update(sourceVersionIds=[]),
    lambda p: p['outputs'].append(copy.deepcopy(p['outputs'][0])),
    lambda p: p['outputs'][0]['sourceVersionIds'].append(p['outputs'][0]['sourceVersionIds'][0]),
    lambda p: p.update(summary=' '),
    lambda p: p['code'].update(language='JAVASCRIPT'),
    lambda p: p['code'].update(source='x' * 32001),
])
def test_malformed_plan_fields_fail_closed(mutate):
    plan = payload('plan.json'); mutate(plan)
    with pytest.raises(ValueError): Plan.model_validate(plan)


@pytest.mark.parametrize('mutate', [
    lambda p: p['inputs'][0]['selection'].update(sourceId='00000000-0000-4000-8000-000000000099'),
    lambda p: p['inputs'][0]['selection'].update(sheetName='Uninspected'),
    lambda p: p['inputs'][0]['selection'].update(columns=[99]),
    lambda p: p['inputs'][0]['selection'].update(columns=[1, 1]),
    lambda p: p['inputs'][0]['selection'].update(sheetName=None),
    lambda p: p['request'].update(templateId='arbitrary-code'),
    lambda p: p['inputs'].append(copy.deepcopy(p['inputs'][0])),
])
def test_invalid_request_is_refused_before_a_provider_call(mutate):
    raw = payload(); mutate(raw)
    with pytest.raises(ValueError): PlanningRequest.model_validate(raw)


def test_unrestricted_inspected_selection_and_empty_sheet_handling():
    raw = payload(); raw['inputs'][0]['selection'].update(sheetName=None, columns=None)
    command = PlanningRequest.model_validate(raw)
    Plan.model_validate_json(ModelGateway(FakeModelProvider()).plan_computation(command).output).validate_for(command)
    raw['inputs'][0]['preview']['sheets'][0]['columns'] = []
    with pytest.raises(ProviderError) as e: ModelGateway(FakeModelProvider()).plan_computation(PlanningRequest.model_validate(raw))
    assert e.value.code == 'AI_OUTPUT_INVALID'


def test_raw_invalid_model_candidate_is_bounded_for_the_java_audit_and_code_is_inert(tmp_path):
    marker = tmp_path / 'must-not-exist'
    plan = payload('plan.json'); plan['code']['source'] = f"open({str(marker)!r}, 'w').write('executed')"
    body = cloud_payload(); body['choices'][0]['message']['content'] = json.dumps(plan)
    provider, _ = cloud(json.dumps(body).encode())
    result = ModelGateway(provider).plan_computation(request())
    assert 'open(' in result.output and not marker.exists()
    body['choices'][0]['message']['content'] = '{invalid json'
    provider, _ = cloud(json.dumps(body).encode())
    assert ModelGateway(provider).plan_computation(request()).output == '{invalid json'
    body['choices'][0]['message']['content'] = 'x' * 64001
    provider, _ = cloud(json.dumps(body).encode())
    with pytest.raises(ProviderError) as e: ModelGateway(provider).plan_computation(request())
    assert e.value.code == 'AI_OUTPUT_INVALID'


@pytest.mark.parametrize('failure, expected', [(ProviderError('AI_REFUSED'), 422), (ProviderError('AI_OUTPUT_INVALID'), 502),
    (ProviderError('AI_UNAVAILABLE', True), 503), (RuntimeError('private body'), 502)])
def test_authenticated_http_boundary_has_safe_failures_and_no_hidden_retries(failure, expected):
    gateway = Mock(); gateway.plan_computation.side_effect = failure
    with TestClient(create_app(service_token=TOKEN, model_gateway=gateway)) as client:
        assert client.post('/internal/analysis/plan', json=payload()).status_code == 401
        assert client.post('/internal/analysis/plan', headers=AUTH, json={}).status_code == 400
        result = client.post('/internal/analysis/plan', headers=AUTH, json=payload())
        assert result.status_code == expected and 'private body' not in result.text
        assert result.headers['cache-control'] == 'no-store'
        assert gateway.plan_computation.call_count == 1


def test_real_http_worker_plans_with_the_pinned_offline_provider():
    with TestClient(create_app(service_token=TOKEN)) as client:
        result = client.post('/internal/analysis/plan', headers=AUTH, json=payload())
        assert result.status_code == 200
        candidate = Candidate.model_validate(result.json())
        Plan.model_validate_json(candidate.output).validate_for(request())


def test_unexpected_provider_failure_is_sanitized():
    provider = Mock(); provider.model_metadata.side_effect = RuntimeError('secret')
    with pytest.raises(ProviderError) as e: ModelGateway(provider).plan_computation(request())
    assert e.value.code == 'AI_PROVIDER_ERROR' and 'secret' not in str(e.value)


def impedance_request(labels=('frequency (Hz)', 'voltage (V)', 'current (mA)'), file_format='CSV'):
    raw = payload()
    raw['request']['instruction'] = 'Calculate impedance versus frequency with a table and chart.'
    item = raw['inputs'][0]
    item['selection']['columns'] = [1, 2, 3]
    item['preview']['format'] = file_format
    sheet = item['preview']['sheets'][0]
    sheet['columns'] = [dict(copy.deepcopy(sheet['columns'][1]), index=index, name=label, inferredType='NUMBER')
                        for index, label in enumerate(labels, 1)]
    sheet['sampleRows'] = []
    return PlanningRequest.model_validate(raw)


def test_impedance_fixture_generates_only_code_and_si_unit_conversion_without_preview_results():
    import ast
    command = impedance_request()
    plan = Plan.model_validate_json(ModelGateway(FakeModelProvider()).plan_computation(command).output)
    plan.validate_for(command)
    assert [item.kind for item in plan.outputs] == ['TABLE', 'CHART']
    assert plan.inputs[0].required_columns == [1, 2, 3]
    assert 'FACTORS = [1, 1, 0.001]' in plan.code.source
    assert 'voltage / current' in plan.code.source and '/outputs/result.json' in plan.code.source
    assert 'frame.values.tolist()' in plan.code.source
    ast.parse(plan.code.source)  # Syntax check only; model source never executes in the worker.
    assert 'numeric results are produced only by isolated execution' in plan.warnings[0]


@pytest.mark.parametrize('template', ['computation-plan:1', 'computation-plan:2', 'computation-plan:3'])
def test_current_execution_policy_is_accepted_without_accepting_unknown_template_versions(template):
    raw = impedance_request().model_dump(by_alias=True)
    raw['request']['templateId'] = template
    command = PlanningRequest.model_validate(raw)
    plan = Plan.model_validate_json(ModelGateway(FakeModelProvider()).plan_computation(command).output)
    plan.validate_for(command)
    assert [output.kind for output in plan.outputs] == ['TABLE', 'CHART']
    assert "'schemaVersion': '2.0'" in plan.code.source
    assert "'xAxis':" in plan.code.source and "'yAxis':" in plan.code.source
    assert "'yTransform': 'ABS'" in plan.code.source
    raw['request']['templateId'] = 'computation-plan:4'
    with pytest.raises(ValueError):
        PlanningRequest.model_validate(raw)


@pytest.mark.parametrize('labels,factors', [
    (('f kHz', 'U mV', 'I µA'), '[1000, 0.001, 1e-06]'),
    (('częstotliwość MHz', 'napięcie V', 'prąd A'), '[1000000, 1, 1]'),
    (('frequency', 'voltage', 'current'), '[1, 1, 1]'),
])
def test_impedance_known_aliases_units_and_explicit_bare_header_assumption(labels, factors):
    command = impedance_request(labels, 'XLSX')
    plan = Plan.model_validate_json(ModelGateway(FakeModelProvider()).plan_computation(command).output)
    plan.validate_for(command)
    assert 'FACTORS = ' + factors in plan.code.source and "FORMAT = 'XLSX'" in plan.code.source
    assert ('Bare column labels' in ' '.join(plan.assumptions)) == (labels[0] == 'frequency')


@pytest.mark.parametrize('mutate', [
    lambda v: v['request'].update(instruction='Fit a curve'),
    lambda v: v['inputs'][0]['preview']['sheets'][0]['columns'][2].update(name='current unknownUnit'),
    lambda v: v['inputs'][0]['preview']['sheets'][0]['columns'][2].update(name='voltage (V)'),
    lambda v: v['inputs'][0]['preview']['sheets'][0].update(headerRow=None),
    lambda v: v['inputs'][0]['selection'].update(columns=[1, 2]),
])
def test_unknown_or_ambiguous_impedance_requests_remain_inert(mutate):
    raw = impedance_request().model_dump(by_alias=True); mutate(raw)
    command = PlanningRequest.model_validate(raw)
    plan = Plan.model_validate_json(ModelGateway(FakeModelProvider()).plan_computation(command).output)
    assert plan.code.source.startswith('raise RuntimeError')


def test_impedance_multiple_selected_sheets_are_ambiguous_and_protocol_is_supplied_to_cloud():
    raw = impedance_request().model_dump(by_alias=True)
    raw['inputs'][0]['selection'].update(sheetName=None, columns=None)
    second = copy.deepcopy(raw['inputs'][0]['preview']['sheets'][0]); second['name'] = 'other'
    raw['inputs'][0]['preview']['sheets'].append(second)
    command = PlanningRequest.model_validate(raw)
    plan = Plan.model_validate_json(ModelGateway(FakeModelProvider()).plan_computation(command).output)
    assert plan.code.source.startswith('raise RuntimeError')
    assert '/execution/manifest.json' in command.user_message() and 'finite JSON scalars' in command.user_message()
