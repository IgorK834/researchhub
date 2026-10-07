import io
import json
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import Mock
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from researchhub_worker.ai.contracts import GenerationRequest, ModelMetadata
from researchhub_worker.ai.providers import FoundryModelProvider, ModelGateway, ProviderError, FakeModelProvider
from researchhub_worker.ai.telemetry import invoke, record_payload, error_content, _current
from researchhub_worker.server import create_app

TOKEN = 'telemetry-test-service-token-at-least-32-characters'
REQUEST = json.loads((Path(__file__).resolve().parents[2] / 'contracts/ai/v1/generation-request.json').read_text())
MODEL = ModelMetadata(provider='foundry', name='model', version='deployment-1')


@pytest.mark.parametrize('kind', ['refusal', 'invalid', 'usage-invalid', 'usage-missing'])
def test_failed_provider_response_preserves_only_valid_usage_without_private_text(kind):
    payload = {'id': 'provider-id', 'model': 'model', 'usage': {'prompt_tokens': 120, 'completion_tokens': 30, 'total_tokens': 150},
               'choices': [{'finish_reason': 'stop', 'message': {'content': 'PRIVATE INVALID OUTPUT'}}]}
    if kind == 'refusal':
        payload['choices'][0]['message']['refusal'] = 'PRIVATE REFUSAL'
    if kind == 'usage-invalid':
        payload['usage']['prompt_tokens'] = '120'
    if kind == 'usage-missing':
        del payload['usage']
    opener = Mock()
    opener.open.return_value = io.BytesIO(json.dumps(payload).encode())
    provider = FoundryModelProvider('https://provider.example', 'PRIVATE KEY', 'deployment', MODEL, opener)
    client = TestClient(create_app(service_token=TOKEN, model_gateway=ModelGateway(provider)))
    response = client.post('/internal/ai/generate', json=REQUEST, headers={'Authorization': f'Bearer {TOKEN}'})
    assert response.status_code == (422 if kind == 'refusal' else 502)
    data = response.json()
    assert set(data) == {'code', 'telemetry'}
    assert data['telemetry']['model']['name'] == 'model'
    assert data['telemetry']['usage'] == (None if kind.startswith('usage-') else {
        'inputTokens': 120, 'outputTokens': 30, 'totalTokens': 150, 'estimated': False})
    assert 'PRIVATE' not in response.text and 'instruction' not in response.text


def test_unknown_metadata_safe_error_and_success_reset_context():
    gateway = Mock()
    gateway.model_metadata.side_effect = RuntimeError('PRIVATE KEY')
    gateway.generate_structured.side_effect = ProviderError('AI_UNAVAILABLE', True)
    assert _current.get() is None
    with pytest.raises(ProviderError) as failed:
        invoke(gateway, gateway.generate_structured, GenerationRequest.model_validate(REQUEST))
    assert error_content(failed.value) == {'code': 'AI_UNAVAILABLE'}
    assert _current.get() is None
    fake = ModelGateway(FakeModelProvider())
    result = invoke(fake, fake.generate_structured, GenerationRequest.model_validate(REQUEST))
    assert result.usage.estimated and _current.get() is None


def test_parallel_failures_keep_usage_isolated_and_context_is_clean():
    class Gateway:
        def model_metadata(self):
            return MODEL
        def operation(self, count):
            record_payload(MODEL, {'usage': {'prompt_tokens': count, 'completion_tokens': 1, 'total_tokens': count + 1}})
            raise ProviderError('AI_OUTPUT_INVALID')
    gateway = Gateway()
    def run(count):
        with pytest.raises(ProviderError) as error:
            invoke(gateway, gateway.operation, count)
        assert _current.get() is None
        return error_content(error.value)['telemetry']['usage']['inputTokens']
    with ThreadPoolExecutor(max_workers=4) as pool:
        assert list(pool.map(run, range(20))) == list(range(20))


def test_shared_failure_contract_matches_the_spring_wire_adapter():
    fixture = json.loads((Path(__file__).resolve().parents[2] / 'contracts/ai/telemetry/v1/provider-failure.json').read_text())
    gateway = Mock()
    metadata = ModelMetadata.model_validate(fixture['telemetry']['model'])
    gateway.model_metadata.return_value = metadata
    def fail(command):
        usage = fixture['telemetry']['usage']
        record_payload(metadata, {'usage': {'prompt_tokens': usage['inputTokens'], 'completion_tokens': usage['outputTokens'], 'total_tokens': usage['totalTokens']}})
        raise ProviderError(fixture['code'])
    with pytest.raises(ProviderError) as error:
        invoke(gateway, fail, None)
    assert error_content(error.value) == fixture
    assert _current.get() is None
