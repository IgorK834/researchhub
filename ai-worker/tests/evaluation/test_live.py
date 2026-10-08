from copy import deepcopy
from io import BytesIO
import json
from pathlib import Path
from unittest.mock import Mock
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlsplit
from uuid import uuid5

import pytest

from researchhub_worker.ai.providers import FakeModelProvider
from researchhub_worker.evaluation import __main__ as cli
from researchhub_worker.evaluation.live import SpringClient, SpringBackend, seed, ApiFailure, NoRedirect
from researchhub_worker.evaluation.offline import OfflineBackend, contextual_request
from researchhub_worker.evaluation.runner import run
from researchhub_worker.retrieval.contracts import identity_digest


class FixtureSpring:
    """Canonical Spring wire shape and real worker chunking/generation; no DB shortcut."""
    def __init__(self, loaded, config):
        self.loaded, self.config = loaded, config
        self.offline = OfflineBackend(loaded, config)
        self.workspaces = {str(s.workspace_fixture_id): str(uuid5(s.workspace_fixture_id, 'live')) for s in loaded.suite.sources}
        self.sources, self.manifests, self.extractions, self.runtime, self.canonical = {}, {}, {}, {}, {}
        self.bindings = {'schemaVersion': '1.0', 'suiteHash': loaded.suite_hash, 'corpusHash': loaded.corpus_hash,
            'workspaces': self.workspaces, 'sources': {}}
        for source in loaded.suite.sources:
            workspace = self.workspaces[str(source.workspace_fixture_id)]
            id, version = str(uuid5(source.id, 'live')), str(uuid5(source.id, 'version'))
            self.bindings['sources'][str(source.id)] = {'sourceId': id, 'workspaceId': workspace, 'sourceVersionId': version}
            self.sources[id] = {'id': id, 'workspaceId': workspace, 'name': source.title, 'originalFilename': Path(source.path).name,
                'contentSha256': source.sha256, 'activeVersionId': version, 'status': 'READY'}
            extracted = loaded.extractions[source.id].model_dump(mode='json', by_alias=True)
            self.extractions[id] = extracted
            chunks = []
            for canonical in self.offline.chunks:
                if canonical.source_id != source.id:
                    continue
                runtime_id = identity_digest([workspace, id, None, canonical.processing_version, canonical.chunk_index,
                    canonical.content_hash, [[s.unit_id, s.character_start, s.character_end] for s in canonical.spans]])
                from uuid import UUID
                runtime = canonical.model_copy(update={'source_id': UUID(id), 'workspace_id': UUID(workspace),
                    'source_version_id': UUID(version), 'chunk_id': runtime_id})
                self.runtime[canonical.chunk_id], self.canonical[runtime_id] = runtime, canonical
                chunks.append(runtime.model_dump(mode='json', by_alias=True))
            self.manifests[id] = {'config': config.chunking.model_dump(mode='json', by_alias=True), 'chunks': chunks}
        self.uploaded, self.created, self.calls = [], [], []

    def get(self, path):
        self.calls.append(('GET', path))
        if path == '/api/workspaces':
            return [{'id': id, 'name': f'Evaluation {self.loaded.suite.id}:{self.loaded.suite.version} {fixture}'} for fixture, id in self.workspaces.items()]
        parts = urlsplit(path)
        segments = parts.path.split('/')
        workspace = segments[3]
        if parts.path.endswith('/ai/model'):
            return FakeModelProvider().model_metadata().model_dump(mode='json', by_alias=True)
        if '/retrieval/search' in path:
            params = parse_qs(parts.query)
            case = self.case(params['query'][0], workspace)
            chunks = self.offline.retrieve(case)
            details = self.offline.retrieval_diagnostics()
            return [{'chunk': self.runtime[c.chunk_id].model_dump(mode='json', by_alias=True), 'score': d.score,
                'vectorSimilarity': d.vector_similarity, 'lexicalScore': d.lexical_score,
                'model': d.embedding_model.model_dump(mode='json', by_alias=True)} for c, d in zip(chunks, details)]
        if parts.path.endswith('/sources'):
            return [deepcopy(s) for s in self.sources.values() if s['workspaceId'] == workspace]
        id = segments[5]
        if parts.path.endswith('/extraction'):
            return deepcopy(self.extractions[id])
        if parts.path.endswith('/retrieval'):
            return deepcopy(self.manifests[id])
        return deepcopy(self.sources[id])

    def case(self, question, workspace):
        return next(c for c in self.loaded.suite.cases if c.question == question and
            self.workspaces[str(c.workspace_fixture_id)] == workspace)

    def post(self, path, body=None):
        self.calls.append(('POST', path))
        if path == '/api/workspaces':
            self.created.append(body)
            fixture = body['name'].split()[-1]
            return {'id': self.workspaces[fixture]}
        workspace = path.split('/')[3]
        case = self.case(body['question'], workspace)
        if body['selectedSourceIds'] == []:
            return {'status': 'INSUFFICIENT_EVIDENCE', 'citations': [], 'generation': None}
        chunks = [self.runtime[c.chunk_id] for c in self.offline.retrieve(case)]
        result = FakeModelProvider().generate_structured(contextual_request(case, chunks, self.config))
        return {'status': result.answer.status, 'citations': [], 'generation': {
            'result': result.model_dump(mode='json', by_alias=True),
            'evidence': [c.model_dump(mode='json', by_alias=True) for c in chunks]}}

    def upload(self, path, file):
        self.uploaded.append(file.name)
        return next(deepcopy(s) for s in self.sources.values() if s['originalFilename'] == file.name)


@pytest.fixture
def spring(loaded, config):
    return FixtureSpring(loaded, config)


def test_full_seed_and_live_run_use_api_authorization_and_actual_model_context(loaded, config, spring):
    binding = seed(loaded, spring)
    assert binding == spring.bindings
    assert seed(loaded, spring) == binding
    assert not spring.created and not spring.uploaded
    live_config = config.model_copy(update={'index': 'spring-hybrid'})
    backend = SpringBackend(loaded, live_config, spring, binding)
    report = run(loaded, live_config, backend)
    assert report['summary']['failures'] == 0
    assert report['summary']['spanRecallAtK']['value'] == 1
    assert report['summary']['chunkRecallAtK']['value'] == 1
    assert report['manifest']['backend']['productionIndex'] is True
    assert report['manifest']['backend']['chunkBindings']
    empty = next(r for r in report['cases'] if r['caseId'] == 'empty-scope')
    assert empty['answer']['providedChunks'] == [] and empty['metrics']['answerCorrectness'] == 1
    assert all('/api/' in path for _, path in spring.calls)


def test_seed_creates_only_missing_fixtures_and_polls_boundedly(loaded, spring):
    original = spring.get
    read_counts = {}
    def missing(path):
        if path == '/api/workspaces' or path.endswith('/sources'):
            return []
        result = original(path)
        if not path.endswith(('/extraction', '/retrieval', '/model')):
            read_counts[path] = read_counts.get(path, 0)+1
            if read_counts[path] == 1:
                result['status'] = 'PROCESSING'
        return result
    spring.get = missing
    sleeps = []
    assert seed(loaded, spring, sleep=sleeps.append)['sources'] == spring.bindings['sources']
    assert len(spring.created) == 2 and len(spring.uploaded) == 8 and sleeps == [0.5]*8


@pytest.mark.parametrize('problem', ['duplicate-workspace', 'extra-source', 'duplicate-source', 'hash', 'failed', 'timeout'])
def test_seed_refuses_ambiguous_drift_and_processing_failure(loaded, spring, problem):
    original = spring.get
    def broken(path):
        result = original(path)
        if path == '/api/workspaces' and problem == 'duplicate-workspace':
            return result*2
        if path.endswith('/sources'):
            if problem == 'extra-source':
                return result+[{'originalFilename': 'unexpected.txt'}]
            if problem == 'duplicate-source':
                return result*2
            if problem == 'hash':
                for item in result:
                    item['contentSha256'] = '0'*64
        if isinstance(result, dict) and 'status' in result:
            if problem == 'failed':
                result['status'] = 'FAILED'
            if problem == 'timeout':
                result['status'] = 'PROCESSING'
        return result
    spring.get = broken
    with pytest.raises((ValueError, ApiFailure)):
        seed(loaded, spring, timeout=0, sleep=lambda _: None)


@pytest.mark.parametrize('problem', ['schema', 'suite', 'index', 'missing-binding', 'collapsed-workspace',
    'workspace-binding', 'source-hash', 'active-version', 'config', 'text', 'unit', 'unit-count',
    'chunk-scope', 'chunk-content', 'chunk-count', 'extra-source'])
def test_live_adapter_fails_closed_on_corpus_and_scope_drift(loaded, config, spring, problem):
    binding = deepcopy(spring.bindings)
    live_config = config.model_copy(update={'index': 'spring-hybrid'})
    first = loaded.suite.sources[0]
    id = binding['sources'][str(first.id)]['sourceId']
    if problem == 'schema':
        binding['schemaVersion'] = '99'
    elif problem == 'suite':
        binding['suiteHash'] = '0'*64
    elif problem == 'index':
        live_config = config
    elif problem == 'missing-binding':
        binding['sources'].pop(str(first.id))
    elif problem == 'collapsed-workspace':
        keys = list(binding['workspaces'])
        binding['workspaces'][keys[1]] = binding['workspaces'][keys[0]]
    elif problem == 'workspace-binding':
        binding['sources'][str(first.id)]['workspaceId'] = '10000000-0000-0000-0000-000000000001'
    elif problem == 'source-hash':
        spring.sources[id]['contentSha256'] = '0'*64
    elif problem == 'active-version':
        spring.sources[id]['activeVersionId'] = '10000000-0000-0000-0000-000000000001'
    elif problem == 'config':
        spring.manifests[id]['config']['maxCharacters'] = 100
    elif problem == 'text':
        spring.extractions[id]['chunks'][0]['text'] += 'drift'
    elif problem == 'unit':
        spring.extractions[id]['chunks'][0]['chunkId'] = 'unit-fabricated'
    elif problem == 'unit-count':
        spring.extractions[id]['chunks'].append({'text': ''})
    elif problem == 'chunk-scope':
        spring.manifests[id]['chunks'][0]['workspaceId'] = '10000000-0000-0000-0000-000000000001'
    elif problem == 'chunk-content':
        spring.manifests[id]['chunks'][0]['spans'][0]['characterEnd'] -= 1
    elif problem == 'chunk-count':
        spring.manifests[id]['chunks'].pop()
    elif problem == 'extra-source':
        spring.sources['new'] = {'id': 'new', 'workspaceId': spring.sources[id]['workspaceId']}
    with pytest.raises(ValueError):
        SpringBackend(loaded, live_config, spring, binding)


@pytest.mark.parametrize('problem', ['retrieval', 'template', 'context-id', 'context-provenance', 'status', 'no-generation'])
def test_live_adapter_rejects_inference_and_index_changes_after_verification(loaded, config, spring, problem):
    live_config = config.model_copy(update={'index': 'spring-hybrid'})
    backend = SpringBackend(loaded, live_config, spring, spring.bindings)
    case = loaded.suite.cases[0]
    if problem == 'retrieval':
        spring.get = lambda _: [{'chunk': spring.manifests[next(iter(spring.manifests))]['chunks'][0] | {'chunkIndex': 99}}]
        with pytest.raises(ValueError):
            backend.retrieve(case)
        return
    original = spring.post
    def invalid(path, body):
        payload = original(path, body)
        if problem == 'template':
            payload['generation']['result']['templateHash'] = '0'*64
        elif problem == 'context-id':
            payload['generation']['evidence'][0]['chunkId'] = '0'*64
        elif problem == 'context-provenance':
            payload['generation']['evidence'][0]['pageStart'] = 99
        elif problem == 'status':
            payload['status'] = 'INSUFFICIENT_EVIDENCE'
        else:
            payload['generation'] = None
        return payload
    spring.post = invalid
    with pytest.raises(ValueError):
        backend.answer(case, [])


def test_model_and_corpus_drift_during_run_invalidate_snapshot(loaded, config, spring):
    live_config = config.model_copy(update={'index': 'spring-hybrid'})
    backend = SpringBackend(loaded, live_config, spring, spring.bindings)
    original = spring.get
    def changed(path):
        value = original(path)
        return value | {'version': '2'} if path.endswith('/ai/model') else value
    spring.get = changed
    with pytest.raises(ValueError):
        backend.verify_snapshot()
    spring.get = original
    original_post = spring.post
    def changed_result(path, body):
        value = original_post(path, body)
        value['generation']['result']['model']['version'] = '2'
        return value
    spring.post = changed_result
    with pytest.raises(ValueError):
        backend.answer(loaded.suite.cases[0], [])


def test_live_embedding_identity_and_rank_scores_are_recorded_and_pinned(loaded, config, spring):
    backend = SpringBackend(loaded, config.model_copy(update={'index':'spring-hybrid'}), spring, spring.bindings)
    case = loaded.suite.cases[0]
    chunks = backend.retrieve(case)
    assert [d.chunk_id for d in backend.retrieval_diagnostics()] == [c.chunk_id for c in chunks]
    assert backend.metadata()['embeddingModels']
    original = spring.get
    def changed(path):
        hits = original(path)
        if '/retrieval/search' in path:
            for hit in hits:
                hit['model']['version'] = 'other-vector-space'
        return hits
    spring.get = changed
    with pytest.raises(ValueError):
        backend.retrieve(case)


@pytest.mark.parametrize('url', ['http://example.org', 'https://user:pass@example.org', 'file:///tmp/x',
    'https://example.org/path', 'https://example.org?key=x', 'https://example.org#fragment'])
def test_credentials_cannot_be_sent_to_unsafe_origins(url):
    with pytest.raises(ValueError):
        SpringClient(url)


def test_http_client_uses_csrf_bounded_requests_and_never_follows_redirects(tmp_path):
    client = SpringClient('http://127.0.0.1:8080')
    response = Mock()
    response.__enter__ = Mock(return_value=response)
    response.__exit__ = Mock(return_value=False)
    response.read.return_value = b'{"ok":true}'
    client.opener = Mock()
    client.opener.open.return_value = response
    cookie = Mock()
    cookie.name, cookie.value = 'XSRF-TOKEN', 'csrf%20value'
    client.cookies = [cookie]
    client.login('owner@example.test', 'never-print-password')
    login_request = client.opener.open.call_args_list[1].args[0]
    assert login_request.get_header('X-xsrf-token') == 'csrf value'
    assert json.loads(login_request.data)['email'] == 'owner@example.test'
    assert client.opener.open.call_args.kwargs['timeout'] == 30
    response.read.return_value = b''
    assert client.get('/api/auth/csrf') is None
    file = tmp_path / 'fixture.txt'
    file.write_text('immutable corpus')
    client.upload('/api/workspaces/w/sources', file)
    assert b'name="file"' in client.opener.open.call_args.args[0].data
    assert NoRedirect().redirect_request(None, None, None, None, None, None) is None
    with pytest.raises(ValueError):
        client.request('GET', '//external.example/path')
    with pytest.raises(ValueError):
        client.login('', '')
    response.read.return_value = b'x'*(8*1024*1024+1)
    with pytest.raises(ApiFailure):
        client.get('/api/workspaces')
    for error in [HTTPError('unused', 403, '', {}, BytesIO()), URLError('secret url')]:
        client.opener.open.side_effect = error
        with pytest.raises(ApiFailure) as failure:
            client.get('/api/workspaces')
        assert 'secret' not in str(failure.value)


def test_cli_seed_and_live_run_use_environment_login_and_binding_file(loaded, config, spring, tmp_path, monkeypatch):
    spring.login = Mock()
    monkeypatch.setattr(cli, 'SpringClient', lambda *_: spring)
    monkeypatch.setenv('RH_EVALUATION_EMAIL', 'owner@example.test')
    monkeypatch.setenv('RH_EVALUATION_PASSWORD', 'private')
    binding = tmp_path / 'binding.json'
    assert cli.main(['seed', '--url', 'http://localhost:8080', '--output', str(binding)]) == 0
    spring.login.assert_called_with('owner@example.test', 'private')
    config_file = tmp_path / 'spring.json'
    config_file.write_text(config.model_copy(update={'index':'spring-hybrid'}).model_dump_json(by_alias=True))
    output = tmp_path / 'report.json'
    assert cli.main(['run', '--mode', 'spring', '--config', str(config_file), '--url', 'http://localhost:8080',
        '--bindings', str(binding), '--output', str(output)]) == 0
    monkeypatch.setattr(cli, 'configured_gateway', lambda: __import__('researchhub_worker.ai.providers', fromlist=['ModelGateway']).ModelGateway(FakeModelProvider()))
    assert cli.main(['run', '--configured-model', '--output', str(output)]) == 0
