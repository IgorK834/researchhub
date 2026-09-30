import io
import json
from unittest.mock import Mock
from urllib.error import HTTPError, URLError

import pytest
from fastapi.testclient import TestClient

from researchhub_worker.retrieval.embeddings import (
    AzureEmbeddingProvider, BatchedEmbeddingProvider, EmbeddingBatch, EmbeddingError,
    FakeEmbeddingProvider, ModelMetadata, RetryPolicy, configured_provider,
)
from researchhub_worker.server import create_app

MODEL = ModelMetadata(provider='azure', name='text-embedding-3-small', version='1', dimension=2)
TOKEN = 'test-embedding-worker-token-at-least-32-characters'


def azure(payload=None, error=None):
    opener = Mock()
    if error:
        opener.open.side_effect = error
    else:
        opener.open.return_value = io.BytesIO(json.dumps(payload or {'model': MODEL.name,
            'data': [{'index': 1, 'embedding': [0, 1]}, {'index': 0, 'embedding': [1, 0]}]}).encode())
    return AzureEmbeddingProvider('https://sample.openai.azure.com', 'secret', 'deployment', MODEL, opener), opener


def test_fake_is_deterministic_and_has_matching_query_document_space():
    provider = BatchedEmbeddingProvider(FakeEmbeddingProvider())
    docs = provider.embed_documents(['mass force', 'irrelevant biology'])
    assert docs == provider.embed_documents(['mass force', 'irrelevant biology'])
    assert provider.embed_query('mass force').vectors == docs.vectors[:1]
    assert provider.embed_documents([]).vectors == []
    assert provider.embed_query('!!!').vectors
    assert docs.metadata.dimension == 32


def test_batches_requests_in_input_order():
    fake = FakeEmbeddingProvider()
    provider = Mock(wraps=fake)
    result = BatchedEmbeddingProvider(provider, batch_size=2).embed_documents(['a', 'b', 'c', 'd', 'e'])
    assert result == fake.embed_documents(['a', 'b', 'c', 'd', 'e'])
    assert [len(call.args[0]) for call in provider.embed_documents.call_args_list] == [2, 2, 1]


@pytest.mark.parametrize('transient,failures,calls', [(True, 2, 3), (True, 3, 3), (False, 1, 1)])
def test_bounded_transient_only_retry(transient, failures, calls):
    fake = FakeEmbeddingProvider()
    provider = Mock(wraps=fake)
    provider.embed_documents.side_effect = [EmbeddingError(transient)] * failures + [fake.embed_documents(['a'])]
    delays = []
    wrapper = BatchedEmbeddingProvider(provider, sleep=delays.append)
    if failures == 2:
        assert wrapper.embed_documents(['a']).vectors
    else:
        with pytest.raises(EmbeddingError):
            wrapper.embed_documents(['a'])
    assert provider.embed_documents.call_count == calls
    assert delays == ([0.2, 0.4] if transient else [])


def test_invalid_provider_count_and_model_are_rejected():
    fake = FakeEmbeddingProvider()
    provider = Mock(wraps=fake)
    provider.embed_documents.return_value = fake.embed_documents([])
    with pytest.raises(EmbeddingError):
        BatchedEmbeddingProvider(provider).embed_documents(['a'])
    provider.embed_documents.return_value = EmbeddingBatch(metadata=MODEL, vectors=[[1, 0]])
    with pytest.raises(EmbeddingError):
        BatchedEmbeddingProvider(provider).embed_documents(['a'])


@pytest.mark.parametrize('vector', [[1], [0, 0], [float('nan'), 1], [float('inf'), 1]])
def test_rejects_incompatible_or_invalid_vectors(vector):
    with pytest.raises(ValueError):
        EmbeddingBatch(metadata=MODEL, vectors=[vector])


@pytest.mark.parametrize('texts', [[''], ['  '], [123], ['a' * 8001], ['a'] * 10001])
def test_invalid_inputs(texts):
    with pytest.raises(ValueError):
        BatchedEmbeddingProvider(FakeEmbeddingProvider()).embed_documents(texts)


def test_azure_contract_orders_vectors_and_does_not_expose_secrets():
    provider, opener = azure()
    assert provider.embed_documents(['a', 'b']).vectors == [[1, 0], [0, 1]]
    request = opener.open.call_args.args[0]
    assert request.full_url.endswith('/openai/v1/embeddings?api-version=v1')
    assert json.loads(request.data)['model'] == 'deployment'
    assert json.loads(request.data)['dimensions'] == 2
    assert provider.model_metadata() == MODEL
    query, _ = azure({'model': MODEL.name, 'data': [{'index': 0, 'embedding': [1, 0]}]})
    assert query.embed_query('a').vectors == [[1, 0]]


@pytest.mark.parametrize('status,transient', [(408, True), (429, True), (503, True), (401, False), (400, False)])
def test_azure_classifies_http_failures(status, transient):
    provider, _ = azure(error=HTTPError('secret-url', status, 'secret', {}, None))
    with pytest.raises(EmbeddingError) as failure:
        provider.embed_documents(['a'])
    assert failure.value.transient is transient
    assert 'secret' not in str(failure.value)


def test_azure_timeout_and_bad_responses():
    provider, _ = azure(error=URLError('secret-url'))
    with pytest.raises(EmbeddingError) as error:
        provider.embed_query('a')
    assert error.value.transient
    for payload in [{'data': []}, {'model': 'wrong', 'data': []},
                    {'model': MODEL.name, 'data': [{'index': 0, 'embedding': [1]}]},
                    {'model': MODEL.name, 'data': [{'index': 0, 'embedding': [1, 0]}, {'index': 0, 'embedding': [1, 0]}]}]:
        provider, _ = azure(payload)
        with pytest.raises(EmbeddingError):
            provider.embed_documents(['a'])
    provider, opener = azure()
    opener.open.return_value = io.BytesIO(b'x' * (4 * 1024 * 1024 + 1))
    with pytest.raises(EmbeddingError):
        provider.embed_query('a')


@pytest.mark.parametrize('kwargs', [{'endpoint': 'http://invalid'}, {'endpoint': 'https://valid/path'},
                                    {'endpoint': 'https://user@valid'}, {'api_key': ''}, {'deployment': ''}])
def test_azure_configuration_fails_closed(kwargs):
    config = dict(endpoint='https://valid', api_key='key', deployment='name', metadata=MODEL)
    config.update(kwargs)
    with pytest.raises(ValueError):
        AzureEmbeddingProvider(**config)


def test_retry_and_batch_limits():
    for kwargs in [dict(attempts=0), dict(attempts=6), dict(initial_delay=0), dict(max_delay=6)]:
        with pytest.raises(ValueError):
            RetryPolicy(**kwargs)
    with pytest.raises(ValueError):
        BatchedEmbeddingProvider(FakeEmbeddingProvider(), batch_size=33)
    provider = Mock(wraps=FakeEmbeddingProvider())
    provider.embed_documents.side_effect = [EmbeddingError(True), EmbeddingError(True), FakeEmbeddingProvider().embed_documents(['a'])]
    delays = []
    BatchedEmbeddingProvider(provider, policy=RetryPolicy(initial_delay=1, max_delay=1), sleep=delays.append).embed_documents(['a'])
    assert delays == [1, 1]


def test_configuration_switches_provider_without_use_case_changes(monkeypatch):
    monkeypatch.setenv('AI_WORKER_EMBEDDING_PROVIDER', 'deterministic')
    assert configured_provider().embed_query('a').metadata.provider == 'deterministic'
    monkeypatch.setenv('AI_WORKER_EMBEDDING_PROVIDER', 'azure')
    for key, value in dict(ENDPOINT='https://valid', API_KEY='key', DEPLOYMENT='deployment', MODEL=MODEL.name, VERSION='1', DIMENSION='2').items():
        monkeypatch.setenv('AZURE_EMBEDDING_' + key, value)
    assert configured_provider().model_metadata() == MODEL
    monkeypatch.setenv('AI_WORKER_EMBEDDING_PROVIDER', 'unknown')
    with pytest.raises(ValueError):
        configured_provider()


def test_internal_http_auth_validation_and_failure_classification():
    provider = BatchedEmbeddingProvider(FakeEmbeddingProvider())
    with TestClient(create_app(service_token=TOKEN, embedding_provider=provider)) as client:
        headers = {'Authorization': 'Bearer ' + TOKEN}
        assert client.get('/internal/embeddings/model').status_code == 401
        assert client.post('/internal/embeddings/query', json={'texts': ['a']}).status_code == 401
        assert client.get('/internal/embeddings/model', headers=headers).json()['dimension'] == 32
        result = client.post('/internal/embeddings/documents', headers=headers, json={'texts': ['mass', 'force']})
        assert result.status_code == 200
        assert len(result.json()['vectors']) == 2
        assert result.headers['cache-control'] == 'no-store'
        assert client.post('/internal/embeddings/query', headers=headers, json={'texts': ['mass']}).status_code == 200
        for operation, payload in [('query', {'texts': ['a', 'b']}), ('query', {'texts': ['']}),
                                   ('documents', {'texts': []}), ('documents', {'texts': 'a'}), ('documents', []),
                                   ('unknown', {'texts': ['a']}), ('documents', {'texts': ['a'], 'extra': 1})]:
            assert client.post('/internal/embeddings/' + operation, headers=headers, json=payload).status_code == 400
    for transient, status in [(True, 503), (False, 422)]:
        failing = Mock()
        failing.embed_query.side_effect = EmbeddingError(transient)
        with TestClient(create_app(service_token=TOKEN, embedding_provider=failing)) as client:
            assert client.post('/internal/embeddings/query', headers=headers, json={'texts': ['mass']}).status_code == status


def test_shared_java_python_contract_roundtrips():
    from pathlib import Path
    path = Path(__file__).resolve().parents[2] / 'contracts/embeddings/v1/batch.json'
    payload = json.loads(path.read_text())
    assert EmbeddingBatch.model_validate(payload).model_dump(by_alias=True) == payload
