"""Native HTTP contract and every structured feature, using a local fake server."""
import json
from unittest.mock import Mock
from urllib.error import URLError

import pytest
from fastapi.testclient import TestClient

from researchhub_worker.ai.gemini import GeminiModelProvider
from researchhub_worker.ai import gemini_http as http
from researchhub_worker.ai.providers import ModelGateway, ProviderError, configured_gateway
from researchhub_worker.ai.telemetry import invoke
from researchhub_worker.retrieval.gemini import GeminiEmbeddingProvider
from researchhub_worker.retrieval.embeddings import BatchedEmbeddingProvider, EmbeddingError, configured_provider
from researchhub_worker.server import create_app
from test_openai_compatible import endpoint
from test_ai import command, cloud_payload, TOKEN, AUTH
from test_ai_context import command as contextual_command, local_cloud_payload


def response(content=None, **changes):
    value = {'responseId': 'native-response-1', 'modelVersion': http.DEFAULT_MODEL,
        'candidates': [{'index': 0, 'finishReason': 'STOP', 'content': {'role': 'model', 'parts': [
            {'text': content if content is not None else cloud_payload()['choices'][0]['message']['content']} ]}}],
        'usageMetadata': {'promptTokenCount': 100, 'candidatesTokenCount': 40, 'thoughtsTokenCount': 10, 'totalTokenCount': 150}}
    value.update(changes)
    return value


def provider(endpoint, **changes):
    return GeminiModelProvider('private-key', base_url='https://compatible.invalid/v1beta', opener=endpoint.opener, **changes)


def test_native_success_context_boundary_and_thinking_usage(endpoint):
    endpoint.responses = [(200, response())]
    model = ModelGateway(provider(endpoint))
    result = invoke(model, model.generate_structured, command())
    assert result.model.provider == 'gemini' and result.usage.output_tokens == 50 and result.usage.total_tokens == 150
    path, headers, body = endpoint.calls[0]
    assert path == '/v1beta/models/gemini-3.8-flash:generateContent'
    assert headers['X-Goog-Api-Key'] == 'private-key' and 'Authorization' not in headers
    assert body['store'] is False and not {'tools', 'toolConfig', 'cachedContent'} & body.keys()
    assert 'UNTRUSTED_EVIDENCE' in body['contents'][0]['parts'][0]['text']
    assert 'private-key' not in json.dumps(body)
    assert body['generationConfig']['responseFormat']['text']['schema']
    assert body['generationConfig']['thinkingConfig'] == {'includeThoughts': False, 'thinkingLevel': 'LOW'}
    endpoint.responses = [(200, response(local_cloud_payload()['choices'][0]['message']['content']))]
    assert model.generate_structured(contextual_command()).answer.claims[0].evidence_ids == ['a' * 64]


@pytest.mark.parametrize('rejection', [
    {'message': 'responseFormat schema keyword not supported'},
    {'message': 'Request contains an invalid argument.', 'status': 'INVALID_ARGUMENT'},
])
def test_schema_fallback_and_exactly_one_repair_use_original_evidence(endpoint, rejection):
    endpoint.responses = [(400, {'error': rejection}),
        (200, response('{private malicious output')), (200, response())]
    result = provider(endpoint).generate_structured(command())
    assert result.usage.total_tokens == 300 and len(endpoint.calls) == 3
    bodies = [call[2] for call in endpoint.calls]
    assert 'schema' not in bodies[1]['generationConfig']['responseFormat']['text']
    assert bodies[0]['contents'] == bodies[1]['contents'] == bodies[2]['contents']
    assert 'private malicious output' not in json.dumps(bodies[2])
    endpoint.responses = [(200, response('{}')), (200, response('{}'))]
    model = ModelGateway(provider(endpoint))
    with pytest.raises(ProviderError) as failure:
        invoke(model, model.generate_structured, command())
    assert failure.value.code == 'AI_OUTPUT_INVALID' and not failure.value.retryable
    assert failure.value.telemetry['usage']['totalTokens'] == 300


def test_authoring_disambiguates_local_citation_keys_from_source_identity(endpoint):
    from test_authoring import command as author_command
    from researchhub_worker.ai.authoring import fake_answer
    request = author_command('EVIDENCE', selected='kinetic energy')
    endpoint.responses = [(200, response(fake_answer(request).model_dump_json(by_alias=True)))]
    ModelGateway(provider(endpoint)).generate_authoring(request)
    system = endpoint.calls[0][2]['systemInstruction']['parts'][0]['text']
    assert 'local labels: ["S1"]' in system and 'Never put chunk hashes or source UUIDs' in system
    assert 'sourceId still use the supplied source UUIDs' in system


@pytest.mark.parametrize('status,code,retryable', [(401, 'AI_PROVIDER_ERROR', False), (400, 'AI_PROVIDER_ERROR', False),
    (408, 'AI_UNAVAILABLE', True), (429, 'AI_UNAVAILABLE', True), (599, 'AI_UNAVAILABLE', True),
    (302, 'AI_PROVIDER_ERROR', False), (307, 'AI_PROVIDER_ERROR', False)])
def test_http_mapping_no_redirects_or_secret_errors(endpoint, status, code, retryable):
    endpoint.responses = [(status, {'error': {'message': 'private-key invalid schema'}})]
    with pytest.raises(ProviderError) as failure:
        provider(endpoint).generate_structured(command())
    assert failure.value.code == code and failure.value.retryable == retryable and len(endpoint.calls) == 1
    assert 'private-key' not in str(failure.value)


@pytest.mark.parametrize('bad', [b'{', b'x' * (256 * 1024 + 1), {},
    response(modelVersion='foreign-model'), response(responseId=''),
    response(candidates=[]), response(usageMetadata={'promptTokenCount': 1, 'totalTokenCount': 9}),
    response(candidates=[{'finishReason': 'MAX_TOKENS'}]),
    response(candidates=[{'finishReason': 'STOP', 'content': {'role': 'model', 'parts': [{'functionCall': {}}]}}]),
    response(candidates=[{'finishReason': 'STOP', 'content': {'role': 'model', 'parts': [{'text': '{}', 'thought': True}]}}]),
    response('x' * 64001)])
def test_bad_envelopes_cap_and_unrequested_capabilities_fail_closed(endpoint, bad):
    endpoint.responses = [(200, bad)]
    with pytest.raises(ProviderError) as failure:
        provider(endpoint).generate_structured(command())
    assert failure.value.code == 'AI_OUTPUT_INVALID' and len(endpoint.calls) == 1


@pytest.mark.parametrize('payload', [response(promptFeedback={'blockReason': 'SAFETY'}),
    response(candidates=[{'finishReason': 'SAFETY'}])])
def test_refusals_preserve_economic_telemetry(endpoint, payload):
    endpoint.responses = [(200, payload)]
    model = ModelGateway(provider(endpoint))
    with pytest.raises(ProviderError) as failure:
        invoke(model, model.generate_structured, command())
    assert failure.value.code == 'AI_REFUSED' and failure.value.telemetry['usage']['totalTokens'] == 150


def test_retry_budget_is_not_reset_after_fallback_or_repair(endpoint):
    endpoint.responses = [(400, {'error': {'message': 'schema unsupported'}}), (429, {})]
    with pytest.raises(ProviderError) as failure:
        ModelGateway(provider(endpoint), sleep=Mock()).generate_structured(command())
    assert not failure.value.retryable and len(endpoint.calls) == 2
    endpoint.responses = [(200, response('{}')), (429, {})]
    with pytest.raises(ProviderError) as failure:
        ModelGateway(provider(endpoint)).generate_structured(command())
    assert not failure.value.retryable


def test_blocked_prompt_without_usage_remains_a_refusal(endpoint):
    endpoint.responses = [(200, {'promptFeedback': {'blockReason': 'SAFETY'}})]
    with pytest.raises(ProviderError) as failure:
        provider(endpoint).generate_structured(command())
    assert failure.value.code == 'AI_REFUSED'


def test_exhausted_daily_quota_does_not_trigger_immediate_gateway_retries(endpoint):
    endpoint.responses = [(429, {'error': {'details': [{'violations': [
        {'quotaId': 'GenerateRequestsPerDayPerProjectPerModel-FreeTier', 'quotaValue': '20'}]}]}})]
    sleep = Mock()
    with pytest.raises(ProviderError) as failure:
        ModelGateway(provider(endpoint), sleep=sleep).generate_structured(command())
    assert failure.value.code == 'AI_UNAVAILABLE' and not failure.value.retryable
    assert len(endpoint.calls) == 1
    sleep.assert_not_called()


def test_all_feature_schemas_and_worker_routes_use_native_adapter(endpoint):
    from test_authoring import command as author_request
    from test_source_analysis import command as analysis_request, local_answer
    from test_computation_planning import request as planning_request, payload as plan_payload
    cases = [(author_request(required=True), '/internal/ai/author',
        {'status': 'READY', 'text': 'Grounded.', 'citationKeys': ['S1'], 'matches': []}),
        (author_request('EVIDENCE'), '/internal/ai/author', {'status': 'READY', 'text': '', 'citationKeys': [],
            'matches': [{'citationKey': 'S1', 'category': 'supporting', 'relevance': 1.0, 'reason': 'Supplied evidence.'}]}),
        (analysis_request(), '/internal/ai/analyze', local_answer(analysis_request())),
        (analysis_request('DISAGREEMENTS'), '/internal/ai/analyze', local_answer(analysis_request('DISAGREEMENTS'))),
        (planning_request(), '/internal/analysis/plan', plan_payload('plan.json'))]
    for action in ['IMPROVE_ACADEMIC_STYLE', 'SHORTEN', 'EXPAND', 'CLARIFY', 'FIX_GRAMMAR', 'EXPLAIN']:
        cases.append((author_request('REWRITE', action, evidence=False), '/internal/ai/author',
            {'status': 'READY', 'text': 'Rewritten.', 'citationKeys': [], 'matches': []}))
    with TestClient(create_app(service_token=TOKEN, model_gateway=ModelGateway(provider(endpoint)))) as client:
        for request, path, answer in cases:
            endpoint.responses = [(200, response('{}')), (200, response(json.dumps(answer)))]
            result = client.post(path, headers=AUTH, json=request.model_dump(mode='json', by_alias=True))
            assert result.status_code == 200, result.text
            assert result.json()['model']['provider'] == 'gemini' and result.json()['usage']['totalTokens'] == 300
            assert endpoint.calls[-1][2]['generationConfig']['thinkingConfig']['thinkingLevel'] == (
                'MEDIUM' if path == '/internal/analysis/plan' else 'LOW')


@pytest.mark.parametrize('dimension', [768, 1536, 3072])
def test_task_aware_embeddings_batch_real_dimensions_below_cap(endpoint, dimension):
    count = 32
    size = http.embedding_batch_size(dimension)
    vector = [0.12345678901234567] * dimension
    endpoint.responses = [(200, {'embeddings': [{'values': vector}] * min(size, count - start)})
        for start in range(0, count, size)]
    adapter = GeminiEmbeddingProvider('key', dimension=dimension, base_url='https://compatible.invalid/v1beta', opener=endpoint.opener)
    result = BatchedEmbeddingProvider(adapter, batch_size=size).embed_documents(['document'] * count)
    assert len(result.vectors) == count and sum(v * v for v in result.vectors[0]) == pytest.approx(1)
    assert result.metadata.dimension == dimension
    for path, headers, body in endpoint.calls:
        assert path.endswith(':batchEmbedContents') and headers['X-Goog-Api-Key'] == 'key'
        config = body['requests'][0]
        assert config['taskType'] == 'RETRIEVAL_DOCUMENT' and config['outputDimensionality'] == dimension
        assert len(body['requests']) <= size
    endpoint.responses = [(200, {'embeddings': [{'values': vector}]})]
    adapter.embed_query('query')
    assert endpoint.calls[-1][2]['requests'][0]['taskType'] == 'RETRIEVAL_QUERY'


@pytest.mark.parametrize('status,raw,transient', [(429, {}, True), (599, {}, True), (401, {}, False),
    (302, {}, False), (200, b'{', False), (200, b'x' * (256 * 1024 + 1), False),
    (200, {'embeddings': []}, False), (200, {'embeddings': [{'values': [1]}]}, False),
    (200, {'embeddings': [{'values': [0] * 768}]}, False),
    (200, {'embeddings': [{'values': [float('inf')] * 768}]}, False)])
def test_embedding_failures(endpoint, status, raw, transient):
    endpoint.responses = [(status, raw)]
    with pytest.raises(EmbeddingError) as failure:
        GeminiEmbeddingProvider('key', base_url='https://compatible.invalid', opener=endpoint.opener).embed_query('text')
    assert failure.value.transient == transient and len(endpoint.calls) == 1


def test_one_key_defaults_explicit_override_and_configuration_failures(monkeypatch):
    monkeypatch.delenv('AI_WORKER_MODEL_PROVIDER', raising=False)
    monkeypatch.setenv('AI_WORKER_EMBEDDING_PROVIDER', '')
    monkeypatch.setenv('GEMINI_API_KEY', 'private-key')
    assert configured_gateway().model_metadata().name == http.DEFAULT_MODEL
    assert configured_provider().model_metadata().dimension == 768
    monkeypatch.setenv('AI_WORKER_MODEL_PROVIDER', 'deterministic')
    assert configured_gateway().model_metadata().provider == 'deterministic'
    monkeypatch.setenv('AI_WORKER_MODEL_PROVIDER', 'gemini')
    monkeypatch.setenv('GEMINI_API_KEY', '')
    with pytest.raises(ValueError):
        configured_gateway()
    for changes in [{'base_url': 'http://host'}, {'model': '../model'}, {'thinking_level': 'minimal'},
                    {'request_timeout': 'nan'}, {'operation_timeout': '1'}]:
        with pytest.raises(ValueError):
            GeminiModelProvider('key', **changes)
    with pytest.raises(ValueError):
        GeminiEmbeddingProvider('key', dimension=32)
    with pytest.raises(ValueError):
        GeminiEmbeddingProvider('key').embed_documents(['a'] * 32)
    assert http.base_url('https://host') == 'https://host/v1beta'


def test_network_and_shared_deadline_are_bounded(monkeypatch):
    opener = Mock()
    opener.open.side_effect = URLError('private-key')
    with pytest.raises(ProviderError) as failure:
        GeminiModelProvider('key', opener=opener).generate_structured(command())
    assert failure.value.retryable and 0 < opener.open.call_args.kwargs['timeout'] <= 30
    with pytest.raises(EmbeddingError) as failure:
        GeminiEmbeddingProvider('key', opener=opener).embed_query('text')
    assert failure.value.transient
    monkeypatch.setattr(http.time, 'monotonic', Mock(side_effect=[0, 91]))
    with http.operation_scope(90), http.operation_scope(90):
        with pytest.raises(TimeoutError):
            http.remaining_timeout(30)


def test_system_ca_fallback_keeps_verification_and_honors_explicit_configuration(monkeypatch):
    import ssl
    context = Mock()
    context.get_ca_certs.return_value = []
    monkeypatch.setattr(http.ssl, 'create_default_context', Mock(return_value=context))
    monkeypatch.setattr(http.os.path, 'isfile', Mock(return_value=True))
    monkeypatch.delenv('SSL_CERT_FILE', raising=False)
    monkeypatch.delenv('SSL_CERT_DIR', raising=False)
    assert http.tls_context() is context
    context.load_verify_locations.assert_called_once_with(cafile='/etc/ssl/cert.pem')
    context.load_verify_locations.reset_mock()
    monkeypatch.setenv('SSL_CERT_FILE', '/operator-ca.pem')
    http.tls_context()
    context.load_verify_locations.assert_not_called()
