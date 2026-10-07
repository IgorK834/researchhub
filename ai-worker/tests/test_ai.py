from __future__ import annotations
from researchhub_worker.ai.safety import EVIDENCE_POLICY

import io
import json
from pathlib import Path
from unittest.mock import Mock
from uuid import UUID
from urllib.error import HTTPError, URLError

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from researchhub_worker.ai.contracts import GenerationRequest, ModelMetadata
from researchhub_worker.ai.providers import (FakeModelProvider, FoundryModelProvider, ModelGateway,
                                            ProviderError, configured_gateway, _NoRedirect)
from researchhub_worker.server import create_app

FIXTURES = Path(__file__).resolve().parents[2] / 'contracts' / 'ai' / 'v1'
TOKEN = 'model-test-service-token-at-least-32-characters'
AUTH = {'Authorization': f'Bearer {TOKEN}'}


def payload():
    return json.loads((FIXTURES / 'generation-request.json').read_text())


def command():
    return GenerationRequest.model_validate(payload())


def cloud_payload():
    return {'id': 'chatcmpl-test', 'model': 'gpt-4o-2024-08-06', 'choices': [{'finish_reason': 'stop',
        'message': {'content': json.dumps({'status': 'SUPPORTED', 'claims': [
            {'text': 'Kinetic energy depends on mass and velocity.', 'evidenceIds': ['a' * 64]}]})}}],
        'usage': {'prompt_tokens': 120, 'completion_tokens': 30, 'total_tokens': 150}}


def cloud(raw=None, error=None):
    opener = Mock()
    opener.open.side_effect = error
    opener.open.return_value = io.BytesIO(raw if raw is not None else json.dumps(cloud_payload()).encode())
    provider = FoundryModelProvider('https://example.openai.azure.com', 'private-test-key', 'grounded',
        ModelMetadata(provider='foundry', name='gpt-4o-2024-08-06', version='deployment-1'), opener)
    return provider, opener


def test_shared_fixture_fake_is_deterministic_and_records_estimated_usage():
    gateway = ModelGateway(FakeModelProvider())
    first = gateway.generate_structured(command())
    assert first == gateway.generate_structured(command())
    assert first.model_dump(mode='json', by_alias=True) == json.loads((FIXTURES / 'generation-result.json').read_text())
    assert first.usage.estimated and first.usage.total_tokens == first.usage.input_tokens + first.usage.output_tokens
    empty = command().model_copy(update={'evidence': []})
    assert gateway.generate_structured(empty).answer.status == 'INSUFFICIENT_EVIDENCE'
    assert gateway.generate_structured(empty).answer.claims == []


@pytest.mark.parametrize('mutate', [
    lambda p: p.update(schemaVersion='2.0'),
    lambda p: p.update(requestId='invalid'),
    lambda p: p.update(templateHash='b' * 64),
    lambda p: p.update(instruction=' '),
    lambda p: p.update(instruction='x' * 4001),
    lambda p: p.update(systemInstruction=' '),
    lambda p: p.update(databaseUrl='postgresql://private'),
    lambda p: p.update(evidence=p['evidence'] * 2),
    lambda p: p.update(evidence=p['evidence'] * 13),
    lambda p: p['evidence'][0].update(contentHash='b' * 64),
    lambda p: p['evidence'][0].update(content=' '),
    lambda p: p['parameters'].update(temperature=2.1),
    lambda p: p['parameters'].update(maxOutputTokens=15),
    lambda p: p['parameters'].update(maxOutputTokens=True),
])
def test_rejects_invalid_or_capability_bearing_request(mutate):
    p = payload()
    mutate(p)
    with pytest.raises(ValidationError):
        GenerationRequest.model_validate(p)


def test_foundry_adapter_uses_strict_schema_explicit_context_and_server_parameters():
    provider, opener = cloud()
    result = ModelGateway(provider).generate_structured(command())
    assert result.model.provider == 'foundry'
    assert result.usage.total_tokens == 150 and not result.usage.estimated
    request = opener.open.call_args.args[0]
    assert request.full_url == 'https://example.openai.azure.com/openai/v1/chat/completions'
    assert request.get_header('Api-key') == 'private-test-key'
    assert opener.open.call_args.kwargs['timeout'] == 8
    body = json.loads(request.data)
    assert body['max_completion_tokens'] == 1024 and body['temperature'] == 0
    assert body['stream'] is False and body['store'] is False
    assert 'tools' not in body and 'functions' not in body
    schema = body['response_format']['json_schema']
    assert schema['strict'] and schema['schema']['additionalProperties'] is False
    assert body['messages'][0]['content'] == command().system_instruction + '\n\n' + EVIDENCE_POLICY
    assert json.loads(body['messages'][1]['content']) == {'instruction': command().instruction, 'evidence': payload()['evidence'], 'evidenceTrust': 'UNTRUSTED_EVIDENCE'}
    provider, opener = cloud()
    omitted = command().model_copy(update={'parameters': command().parameters.model_copy(update={'temperature': None})})
    provider.generate_structured(omitted)
    assert 'temperature' not in json.loads(opener.open.call_args.args[0].data)


@pytest.mark.parametrize('endpoint', ['http://example.com', 'https://user:secret@example.com',
    'https://example.com/openai', 'https://example.com?api-key=private', 'https://example.com#x', 'https://'])
def test_foundry_configuration_rejects_unsafe_origins(endpoint):
    with pytest.raises(ValueError):
        FoundryModelProvider(endpoint, 'key', 'deployment', ModelMetadata(provider='foundry', name='model', version='1'))


def test_foundry_requires_credentials_and_disables_redirects():
    with pytest.raises(ValueError):
        FoundryModelProvider('https://example.com', '', 'deployment', ModelMetadata(provider='foundry', name='model', version='1'))
    provider = FoundryModelProvider('https://example.com/', 'key', 'deployment', ModelMetadata(provider='foundry', name='model', version='1'))
    assert provider._url.endswith('/openai/v1/chat/completions')
    assert _NoRedirect().redirect_request(None, None, 302, 'move', {}, 'https://attacker.com') is None


@pytest.mark.parametrize('status,retryable', [(408, True), (429, True), (500, True), (502, True),
    (503, True), (504, True), (400, False), (401, False), (403, False), (302, False)])
def test_cloud_errors_are_safe_and_classified(status, retryable):
    provider, _ = cloud(error=HTTPError('https://private', status, 'secret provider body', {}, io.BytesIO(b'private')))
    with pytest.raises(ProviderError) as error:
        provider.generate_structured(command())
    assert error.value.retryable is retryable
    assert error.value.code == ('AI_UNAVAILABLE' if retryable else 'AI_PROVIDER_ERROR')
    assert 'private' not in str(error.value) and error.value.__cause__ is None


@pytest.mark.parametrize('failure', [TimeoutError('secret'), URLError('secret')])
def test_network_failure_is_bounded_to_three_attempts(failure):
    provider, opener = cloud(error=failure)
    sleep = Mock()
    with pytest.raises(ProviderError, match='could not complete') as error:
        ModelGateway(provider, sleep).generate_structured(command())
    assert error.value.code == 'AI_UNAVAILABLE'
    assert opener.open.call_count == 3
    assert [call.args[0] for call in sleep.call_args_list] == [0.2, 0.4]


def test_transient_failure_recovers_but_permanent_failure_is_not_retried():
    provider = Mock()
    provider.model_metadata.return_value = FakeModelProvider().model_metadata()
    expected = FakeModelProvider().generate_structured(command())
    provider.generate_structured.side_effect = [ProviderError('AI_UNAVAILABLE', True), expected]
    sleep = Mock()
    assert ModelGateway(provider, sleep).generate_structured(command()) == expected
    assert sleep.call_count == 1
    provider.generate_structured.side_effect = ProviderError()
    provider.generate_structured.reset_mock()
    with pytest.raises(ProviderError):
        ModelGateway(provider, sleep).generate_structured(command())
    assert provider.generate_structured.call_count == 1


@pytest.mark.parametrize('mutate,code', [
    (lambda p: p.update(model='wrong-model'), 'AI_OUTPUT_INVALID'),
    (lambda p: p.update(choices=[]), 'AI_OUTPUT_INVALID'),
    (lambda p: p['choices'][0].update(finish_reason='length'), 'AI_OUTPUT_INVALID'),
    (lambda p: p['choices'][0].update(finish_reason='content_filter'), 'AI_REFUSED'),
    (lambda p: p['choices'][0]['message'].update(refusal='private reason'), 'AI_REFUSED'),
    (lambda p: p['choices'][0]['message'].update(tool_calls=[{'name': 'read_database'}]), 'AI_OUTPUT_INVALID'),
    (lambda p: p['choices'][0]['message'].update(function_call={'name': 'read_file'}), 'AI_OUTPUT_INVALID'),
    (lambda p: p['choices'][0]['message'].update(content='not-json'), 'AI_OUTPUT_INVALID'),
    (lambda p: p['usage'].update(total_tokens=1), 'AI_OUTPUT_INVALID'),
    (lambda p: p['usage'].update(prompt_tokens=-1), 'AI_OUTPUT_INVALID'),
    (lambda p: p['usage'].update(completion_tokens='30'), 'AI_OUTPUT_INVALID'),
    (lambda p: p['choices'][0]['message'].update(content=json.dumps({'status':'SUPPORTED','claims':[]})), 'AI_OUTPUT_INVALID'),
    (lambda p: p['choices'][0]['message'].update(content=json.dumps({'status':'INSUFFICIENT_EVIDENCE','claims':[{'text':'bad','evidenceIds':['a'*64]}]})), 'AI_OUTPUT_INVALID'),
    (lambda p: p['choices'][0]['message'].update(content=json.dumps({'status':'SUPPORTED','claims':[{'text':'bad','evidenceIds':['b'*64]}]})), 'AI_OUTPUT_INVALID'),
    (lambda p: p['choices'][0]['message'].update(content=json.dumps({'status':'SUPPORTED','claims':[{'text':' ','evidenceIds':['a'*64]}]})), 'AI_OUTPUT_INVALID'),
    (lambda p: p['choices'][0]['message'].update(content=json.dumps({'status':'SUPPORTED','claims':[{'text':'bad','evidenceIds':['a'*64]*2}]})), 'AI_OUTPUT_INVALID'),
    (lambda p: p.pop('id'), 'AI_OUTPUT_INVALID'),
])
def test_invalid_cloud_output_and_refusals_fail_closed(mutate, code):
    p = cloud_payload()
    mutate(p)
    provider, opener = cloud(json.dumps(p).encode())
    with pytest.raises(ProviderError) as error:
        ModelGateway(provider, Mock()).generate_structured(command())
    assert error.value.code == code and not error.value.retryable
    assert opener.open.call_count == 1


@pytest.mark.parametrize('raw', [b'null', b'not-json', b'x' * (256 * 1024 + 1)])
def test_malformed_or_oversized_output_is_rejected(raw):
    provider, _ = cloud(raw)
    with pytest.raises(ProviderError) as error:
        provider.generate_structured(command())
    assert error.value.code == 'AI_OUTPUT_INVALID'


@pytest.mark.parametrize('field,value', [('request_id', UUID('20000000-0000-0000-0000-000000000001')),
    ('template_id', 'other:1'), ('template_hash', 'b' * 64),
    ('model', ModelMetadata(provider='other', name='model', version='1'))])
def test_gateway_validates_provider_identity(field, value):
    provider = Mock()
    provider.model_metadata.return_value = FakeModelProvider().model_metadata()
    provider.generate_structured.return_value = FakeModelProvider().generate_structured(command()).model_copy(update={field: value})
    with pytest.raises(ProviderError) as error:
        ModelGateway(provider).generate_structured(command())
    assert error.value.code == 'AI_OUTPUT_INVALID'


def test_provider_selection_is_only_configuration(monkeypatch):
    monkeypatch.setenv('AI_WORKER_MODEL_PROVIDER', 'deterministic')
    assert configured_gateway().model_metadata().provider == 'deterministic'
    monkeypatch.setenv('AI_WORKER_MODEL_PROVIDER', 'foundry')
    for name, value in {'FOUNDRY_ENDPOINT':'https://example.com', 'FOUNDRY_API_KEY':'key',
        'FOUNDRY_DEPLOYMENT':'grounded', 'FOUNDRY_MODEL':'model', 'FOUNDRY_MODEL_VERSION':'1'}.items():
        monkeypatch.setenv(name, value)
    assert configured_gateway().model_metadata().provider == 'foundry'
    monkeypatch.delenv('FOUNDRY_MODEL_VERSION')
    with pytest.raises(KeyError):
        configured_gateway()
    monkeypatch.setenv('AI_WORKER_MODEL_PROVIDER', 'unknown')
    with pytest.raises(ValueError):
        configured_gateway()


def test_metadata_and_unknown_provider_errors_are_sanitized():
    assert ProviderError('private API key', True).code == 'AI_PROVIDER_ERROR'
    assert not ProviderError('AI_OUTPUT_INVALID', True).retryable
    provider = Mock()
    provider.model_metadata.side_effect = RuntimeError('private key')
    with pytest.raises(ProviderError) as error:
        ModelGateway(provider).model_metadata()
    assert error.value.code == 'AI_PROVIDER_ERROR'
    provider.model_metadata.side_effect = None
    provider.model_metadata.return_value = None
    with pytest.raises(ProviderError) as error:
        ModelGateway(provider).model_metadata()
    assert error.value.code == 'AI_OUTPUT_INVALID'
    provider.model_metadata.side_effect = ProviderError('AI_UNAVAILABLE', True)
    with pytest.raises(ProviderError) as error:
        ModelGateway(provider).model_metadata()
    assert error.value.retryable


@pytest.mark.parametrize('failure,status,code', [(ProviderError('AI_UNAVAILABLE', True), 503, 'AI_UNAVAILABLE'),
    (RuntimeError('private credentials'), 502, 'AI_PROVIDER_ERROR')])
def test_metadata_endpoint_maps_safe_errors(failure, status, code):
    gateway = Mock()
    gateway.model_metadata.side_effect = failure
    response = TestClient(create_app(service_token=TOKEN, model_gateway=gateway)).get('/internal/ai/model', headers=AUTH)
    assert response.status_code == status and response.json() == {'code': code}


def test_internal_endpoints_authenticate_validate_and_never_cache():
    provider = Mock(wraps=ModelGateway(FakeModelProvider()))
    client = TestClient(create_app(service_token=TOKEN, model_gateway=provider))
    assert client.get('/internal/ai/model').status_code == 401
    assert client.post('/internal/ai/generate', json=payload()).status_code == 401
    provider.generate_structured.assert_not_called()
    metadata = client.get('/internal/ai/model', headers=AUTH)
    assert metadata.status_code == 200 and metadata.json()['provider'] == 'deterministic'
    result = client.post('/internal/ai/generate', json=payload(), headers=AUTH)
    assert result.status_code == 200 and result.headers['Cache-Control'] == 'no-store'
    assert result.json() == json.loads((FIXTURES / 'generation-result.json').read_text())
    assert client.post('/internal/ai/generate', json=payload() | {'filePath':'/private'}, headers=AUTH).json() == {'code':'AI_REQUEST_INVALID'}
    assert client.post('/internal/ai/generate', content=b'x'* (512*1024+1), headers=AUTH | {'Content-Type':'application/json'}).status_code == 400


@pytest.mark.parametrize('failure,status,code', [(ProviderError('AI_UNAVAILABLE', True),503,'AI_UNAVAILABLE'),
    (ProviderError('AI_REFUSED'),422,'AI_REFUSED'), (ProviderError('AI_OUTPUT_INVALID'),502,'AI_OUTPUT_INVALID'),
    (RuntimeError('private prompt and key'),502,'AI_PROVIDER_ERROR')])
def test_worker_errors_expose_only_safe_codes(failure, status, code):
    gateway = Mock()
    gateway.generate_structured.side_effect = failure
    client = TestClient(create_app(service_token=TOKEN, model_gateway=gateway))
    response = client.post('/internal/ai/generate', json=payload(), headers=AUTH)
    assert response.status_code == status and response.json() == {'code':code}
    assert 'private' not in response.text and response.headers['Cache-Control'] == 'no-store'
