"""Real local HTTP transport, with test-only routing of an HTTPS origin to loopback."""
import io
import json
from http.client import HTTPConnection
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
from urllib.request import HTTPSHandler, build_opener
from urllib.error import URLError
from unittest.mock import Mock

import pytest
from fastapi.testclient import TestClient

from researchhub_worker.ai.contracts import ModelMetadata
from researchhub_worker.ai.providers import OpenAiCompatibleModelProvider, ModelGateway, ProviderError, _NoRedirect, configured_gateway
from researchhub_worker.ai.telemetry import invoke
from researchhub_worker.retrieval.embeddings import OpenAiCompatibleEmbeddingProvider, ModelMetadata as VectorModel, EmbeddingError, configured_provider
from researchhub_worker.server import create_app
from test_ai import command, cloud_payload, TOKEN, AUTH
from test_ai_context import command as contextual_command, local_cloud_payload

MODEL = ModelMetadata(provider='openai-compatible', name='cheap-model', version='snapshot-1')
VECTOR = VectorModel(provider='openai-compatible', name='embedding-small', version='revision-1', dimension=2)


def response(content=None, **changes):
    value = cloud_payload()
    value['model'] = MODEL.name
    if content is not None:
        value['choices'][0]['message']['content'] = content
    value.update(changes)
    return value


@pytest.fixture
def endpoint():
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def do_POST(self):
            server.calls.append((self.path, dict(self.headers), json.loads(self.rfile.read(int(self.headers['Content-Length'])))))
            status, payload = server.responses.pop(0)
            self.send_response(status)
            if status in (301, 302, 307, 308):
                self.send_header('Location', f'http://127.0.0.1:{server.server_port}/stolen-key')
            self.end_headers()
            self.wfile.write(payload if isinstance(payload, bytes) else json.dumps(payload).encode())

    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    server.calls, server.responses = [], []
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()

    class LoopbackTransport(HTTPSHandler):
        def https_open(self, request):
            assert request.host == 'compatible.invalid'
            return self.do_open(lambda host, **kwargs: HTTPConnection('127.0.0.1', server.server_port, **kwargs), request)

    server.opener = build_opener(_NoRedirect, LoopbackTransport)
    yield server
    server.shutdown()
    server.server_close()
    thread.join()


def provider(endpoint):
    return OpenAiCompatibleModelProvider('https://compatible.invalid/api/v1/', 'private-key', MODEL.name, MODEL, endpoint.opener)


def test_success_and_context_boundary(endpoint):
    endpoint.responses = [(200, response())]
    result = ModelGateway(provider(endpoint)).generate_structured(command())
    assert result.model == MODEL and result.answer.claims
    path, headers, body = endpoint.calls[0]
    assert path == '/api/v1/chat/completions' and headers['Authorization'] == 'Bearer private-key'
    assert 'Api-Key' not in headers and body['store'] is False and body['stream'] is False
    assert not {'tools', 'tool_choice', 'functions'} & body.keys()
    assert body['response_format']['json_schema']['strict'] is True
    assert json.loads(body['messages'][1]['content'])['evidenceTrust'] == 'UNTRUSTED_EVIDENCE'
    payload = local_cloud_payload()
    payload['model'] = MODEL.name
    endpoint.responses = [(200, payload)]
    assert provider(endpoint).generate_structured(contextual_command()).answer.claims


def test_strict_rejection_falls_back_and_validates_locally(endpoint):
    endpoint.responses = [(400, {'error': {'param': 'response_format', 'code': 'unsupported_parameter'}}), (200, response())]
    assert provider(endpoint).generate_structured(command()).answer.claims
    assert [c[2]['response_format']['type'] for c in endpoint.calls] == ['json_schema', 'json_object']
    assert 'evidenceTrust' in endpoint.calls[1][2]['messages'][1]['content']


def test_one_repair_and_total_usage(endpoint):
    endpoint.responses = [(200, response('invalid PRIVATE_OUTPUT')), (200, response())]
    result = provider(endpoint).generate_structured(command())
    assert len(endpoint.calls) == 2 and result.usage.total_tokens == 300
    repaired = endpoint.calls[1][2]
    assert 'PRIVATE_OUTPUT' not in json.dumps(repaired)
    assert repaired['messages'][:2] == endpoint.calls[0][2]['messages']
    assert repaired['max_tokens'] == endpoint.calls[0][2]['max_tokens']


@pytest.mark.parametrize('content', ['invalid JSON', '{}', '{"status":"SUPPORTED","claims":[]}',
    json.dumps({'status': 'SUPPORTED', 'claims': [{'text': 'invented', 'evidenceIds': ['f'*64]}]})])
def test_invalid_output_is_bounded_and_error_telemetry_counts_both_attempts(endpoint, content):
    endpoint.responses = [(200, response(content)), (200, response(content))]
    gateway = ModelGateway(provider(endpoint), sleep=lambda _: None)
    with pytest.raises(ProviderError) as failure:
        invoke(gateway, gateway.generate_structured, command())
    assert failure.value.code == 'AI_OUTPUT_INVALID' and len(endpoint.calls) == 2
    assert failure.value.telemetry['usage']['totalTokens'] == 300
    assert 'private-key' not in str(failure.value)


@pytest.mark.parametrize('status,code', [(408, 'AI_UNAVAILABLE'), (429, 'AI_UNAVAILABLE'), (599, 'AI_UNAVAILABLE'),
    (401, 'AI_PROVIDER_ERROR'), (400, 'AI_PROVIDER_ERROR'), (302, 'AI_PROVIDER_ERROR'), (307, 'AI_PROVIDER_ERROR')])
def test_http_classification_and_redirect_refusal(endpoint, status, code):
    endpoint.responses = [(status, {'error': {'message': 'private-key'}})]
    with pytest.raises(ProviderError) as failure:
        provider(endpoint).generate_structured(command())
    assert failure.value.code == code and len(endpoint.calls) == 1
    assert failure.value.retryable == (code == 'AI_UNAVAILABLE')


def test_repair_transient_does_not_restart_the_repair_budget(endpoint):
    endpoint.responses = [(200, response('invalid')), (429, {})]
    with pytest.raises(ProviderError) as failure:
        ModelGateway(provider(endpoint)).generate_structured(command())
    assert failure.value.code == 'AI_UNAVAILABLE' and not failure.value.retryable
    assert len(endpoint.calls) == 2


@pytest.mark.parametrize('raw', [b'{', b'x' * (256*1024+1)])
def test_malformed_envelope_and_oversized_response(endpoint, raw):
    endpoint.responses = [(200, raw)]
    with pytest.raises(ProviderError) as failure:
        provider(endpoint).generate_structured(command())
    assert failure.value.code == 'AI_OUTPUT_INVALID' and len(endpoint.calls) == 1


@pytest.mark.parametrize('changes', [dict(model='other-model'), dict(choices=[]), dict(usage={})])
def test_identity_and_usage_fail_closed(endpoint, changes):
    endpoint.responses = [(200, response(**changes))]
    with pytest.raises(ProviderError):
        provider(endpoint).generate_structured(command())
    assert len(endpoint.calls) == 1


@pytest.mark.parametrize('message,finish,code', [({'content':'{}', 'tool_calls':[{}]}, 'stop', 'AI_OUTPUT_INVALID'),
    ({'content':'{}', 'function_call':{'name':'private'}}, 'stop', 'AI_OUTPUT_INVALID'),
    ({'content':'{}'}, 'length', 'AI_OUTPUT_INVALID'), ({'refusal':'private'}, 'stop', 'AI_REFUSED'),
    ({'content':'{}'}, 'content_filter', 'AI_REFUSED'), ({'content':None}, 'stop', 'AI_OUTPUT_INVALID')])
def test_refusal_and_unexpected_capabilities(endpoint, message, finish, code):
    endpoint.responses = [(200, response(choices=[{'message':message, 'finish_reason':finish}]))]
    with pytest.raises(ProviderError) as failure:
        provider(endpoint).generate_structured(command())
    assert failure.value.code == code and len(endpoint.calls) == 1


@pytest.mark.parametrize('base', ['http://host', 'https://user:pass@host/v1', 'https://@host', 'https://host?q=x',
    'https://host#x', 'https://host?', 'https://host#', 'https://host/../v1', 'https://host/%2fprivate',
    'https://host:invalid', 'https://host:0', 'https://host/a b', 'https://host\\v1', 'https://'])
def test_base_url_rejects_unsafe_configuration(base):
    with pytest.raises(ValueError):
        OpenAiCompatibleModelProvider(base, 'key', MODEL.name, MODEL)


def test_configuration_and_network_timeout(monkeypatch):
    for key, value in dict(BASE_URL='https://compatible.invalid', API_KEY='key', MODEL=MODEL.name,
        MODEL_VERSION=MODEL.version, EMBEDDING_MODEL=VECTOR.name, EMBEDDING_VERSION=VECTOR.version, EMBEDDING_DIMENSION='2').items():
        monkeypatch.setenv('OPENAI_COMPAT_' + key, value)
    monkeypatch.setenv('AI_WORKER_MODEL_PROVIDER', 'openai-compatible')
    monkeypatch.setenv('AI_WORKER_EMBEDDING_PROVIDER', 'openai-compatible')
    assert configured_gateway().model_metadata() == MODEL
    assert configured_provider().model_metadata() == VECTOR
    opener = Mock()
    opener.open.side_effect = URLError('private-key')
    with pytest.raises(ProviderError) as failure:
        OpenAiCompatibleModelProvider('https://host', 'key', MODEL.name, MODEL, opener).generate_structured(command())
    assert failure.value.retryable and opener.open.call_args.kwargs['timeout'] == 8
    monkeypatch.delenv('OPENAI_COMPAT_MODEL_VERSION')
    with pytest.raises(KeyError):
        configured_gateway()
    for key in ('', 'a b', 'key\nheader'):
        with pytest.raises(ValueError):
            OpenAiCompatibleModelProvider('https://host', key, MODEL.name, MODEL)
    with pytest.raises(ValueError):
        OpenAiCompatibleModelProvider('https://host', 'key', 'other', MODEL)


def test_embedding_success_and_fixed_dimension(endpoint):
    endpoint.responses = [(200, {'model':VECTOR.name, 'data':[{'index':1,'embedding':[0,1]}, {'index':0,'embedding':[1,0]}]})]
    adapter = OpenAiCompatibleEmbeddingProvider('https://compatible.invalid/v1', 'private-key', VECTOR, endpoint.opener)
    assert adapter.embed_documents(['a','b']).vectors == [[1,0],[0,1]]
    path, headers, body = endpoint.calls[0]
    assert path == '/v1/embeddings' and headers['Authorization'] == 'Bearer private-key'
    assert body['dimensions'] == 2 and body['model'] == VECTOR.name
    endpoint.responses = [(200, {'model':VECTOR.name, 'data':[{'index':0,'embedding':[1,0]}]})]
    assert adapter.embed_query('a').metadata == VECTOR


@pytest.mark.parametrize('status,transient', [(429,True), (599,True), (401,False), (302,False)])
def test_embedding_http_errors(endpoint, status, transient):
    endpoint.responses = [(status, {})]
    with pytest.raises(EmbeddingError) as failure:
        OpenAiCompatibleEmbeddingProvider('https://compatible.invalid', 'key', VECTOR, endpoint.opener).embed_query('a')
    assert failure.value.transient == transient and len(endpoint.calls) == 1


@pytest.mark.parametrize('payload', [b'{', b'x'*(256*1024+1), {}, {'model':'wrong','data':[]},
    {'model':VECTOR.name,'data':[{'index':0,'embedding':[1]}]},
    {'model':VECTOR.name,'data':[{'index':0,'embedding':[0,0]}]},
    {'model':VECTOR.name,'data':[{'index':0,'embedding':[1,0]}, {'index':0,'embedding':[0,1]}]}])
def test_embedding_bad_output_fails_closed(endpoint, payload):
    endpoint.responses = [(200, payload)]
    with pytest.raises(EmbeddingError):
        OpenAiCompatibleEmbeddingProvider('https://compatible.invalid', 'key', VECTOR, endpoint.opener).embed_query('a')


def test_worker_internal_contract_accepts_compatible_provider(endpoint):
    endpoint.responses = [(200, response())]
    with TestClient(create_app(service_token=TOKEN, model_gateway=ModelGateway(provider(endpoint)))) as client:
        result = client.post('/internal/ai/generate', headers=AUTH, json=command().model_dump(mode='json', by_alias=True))
        assert result.status_code == 200 and result.json()['model']['provider'] == 'openai-compatible'


def test_all_feature_contracts_use_local_validation_and_one_repair(endpoint):
    from test_authoring import command as author_request
    from test_source_analysis import command as analysis_request, local_answer
    from test_computation_planning import request as planning_request, payload as plan_payload
    author = author_request(required=True)
    analysis = analysis_request()
    planner = planning_request()
    for request, operation, answer in [(author, 'generate_authoring', {'status':'READY','text':'Grounded.', 'citationKeys':['S1'],'matches':[]}),
        (analysis, 'generate_analysis', local_answer(analysis)), (planner, 'plan_computation', plan_payload('plan.json'))]:
        endpoint.responses = [(200,response('{}')), (200,response(json.dumps(answer)))]
        result = getattr(ModelGateway(provider(endpoint)),operation)(request)
        assert result.model.provider == 'openai-compatible' and result.usage.total_tokens == 300


def test_rejection_classifier_is_explicit_bounded_and_does_not_retry_arbitrary_bad_requests(endpoint):
    from urllib.error import HTTPError
    for status,payload,expected in [(422,{'error':{'message':'json_schema is not supported'}},True),
        (400,{'error':{'message':'Invalid schema syntax for response_format'}},False),
        (400,{'error':[]},False), (400,{},False), (400,b'bad',False), (400,b'x'*(256*1024+1),False), (429,{},False)]:
        raw=payload if isinstance(payload,bytes) else json.dumps(payload).encode()
        error=HTTPError('https://compatible.invalid',status,'safe',{},io.BytesIO(raw))
        assert OpenAiCompatibleModelProvider._schema_rejected(error)==expected
    endpoint.responses=[(400,{'error':{'param':'response_format','message':'json_schema is unsupported'}}), (200,response('invalid')), (200,response('invalid'))]
    with pytest.raises(ProviderError) as error:
        provider(endpoint).generate_structured(command())
    assert error.value.code=='AI_OUTPUT_INVALID' and len(endpoint.calls)==3
    assert [c[2]['response_format']['type'] for c in endpoint.calls]==['json_schema','json_object','json_object']


def test_embeddings_validate_provider_and_map_network_failure():
    with pytest.raises(ValueError):
        OpenAiCompatibleEmbeddingProvider('https://host','key',VECTOR.model_copy(update={'provider':'azure'}))
    opener=Mock();opener.open.side_effect=URLError('private-key')
    with pytest.raises(EmbeddingError) as error:
        OpenAiCompatibleEmbeddingProvider('https://host','key',VECTOR,opener).embed_query('a')
    assert error.value.transient
