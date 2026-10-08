"""Authenticated Spring API adapter and idempotent fixture seed; no SQL/worker bypass."""
import http.cookiejar
import json
import mimetypes
import ssl
import time
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import unquote, urlencode, urlsplit
from urllib.request import Request, build_opener, HTTPCookieProcessor, HTTPSHandler, HTTPRedirectHandler
from uuid import UUID

from ..ai.contracts import GenerationResult, StructuredAnswer
from ..retrieval.contracts import RetrievalChunk, digest, identity_digest
from ..retrieval.embeddings import ModelMetadata as EmbeddingMetadata
from .contracts import AnswerObservation, RetrievalDiagnostic
from .corpus import digest_bytes, source_path


class ApiFailure(RuntimeError):
    def __init__(self, status=None):
        super().__init__('Evaluation Spring API request failed')
        self.status = status


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class SpringClient:
    def __init__(self, base_url, ca_file=None):
        parts = urlsplit(base_url)
        if (parts.scheme not in ('https', 'http') or not parts.hostname or parts.path not in ('', '/')
                or parts.username or parts.password or parts.query or parts.fragment
                or parts.scheme == 'http' and parts.hostname not in ('localhost', '127.0.0.1', '::1')):
            raise ValueError('Use an HTTPS origin or loopback HTTP for evaluation')
        self.base_url = base_url.rstrip('/')
        self.cookies = http.cookiejar.CookieJar()
        self.opener = build_opener(NoRedirect(), HTTPCookieProcessor(self.cookies),
            HTTPSHandler(context=ssl.create_default_context(cafile=ca_file)))

    def request(self, method, path, body=None, raw=None, content_type=None):
        headers = {'Accept': 'application/json'}
        if not path.startswith('/api/') or path.startswith('//'):
            raise ValueError('Only Spring product API paths are permitted')
        if body is not None:
            raw, content_type = json.dumps(body).encode(), 'application/json'
        if content_type:
            headers['Content-Type'] = content_type
        if method != 'GET':
            token = next((c.value for c in self.cookies if c.name == 'XSRF-TOKEN'), None)
            if token:
                headers['X-XSRF-TOKEN'] = unquote(token)
        try:
            with self.opener.open(Request(self.base_url + path, data=raw, headers=headers, method=method), timeout=30) as response:
                data = response.read(8 * 1024 * 1024 + 1)
                if len(data) > 8 * 1024 * 1024:
                    raise ApiFailure()
                return json.loads(data) if data else None
        except HTTPError as error:
            raise ApiFailure(error.code) from None
        except (URLError, OSError, ValueError):
            raise ApiFailure() from None

    def get(self, path):
        return self.request('GET', path)

    def post(self, path, body=None):
        return self.request('POST', path, body)

    def login(self, email, password):
        if not email or not password:
            raise ValueError('Evaluation login requires environment credentials')
        self.get('/api/auth/csrf')
        self.post('/api/auth/login', {'email': email, 'password': password})
        self.get('/api/auth/csrf')

    def upload(self, path, file):
        boundary = 'rh-evaluation-fixed-corpus'
        data = (f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{file.name}"\r\n'
            f'Content-Type: {mimetypes.guess_type(file.name)[0] or "application/octet-stream"}\r\n\r\n').encode()
        data += file.read_bytes() + f'\r\n--{boundary}--\r\n'.encode()
        return self.request('POST', path, raw=data, content_type='multipart/form-data; boundary=' + boundary)


def seed(loaded, client, timeout=180, clock=time.monotonic, sleep=time.sleep):
    workspaces = client.get('/api/workspaces')
    bindings = {'schemaVersion': '1.0', 'suiteHash': loaded.suite_hash, 'corpusHash': loaded.corpus_hash,
        'workspaces': {}, 'sources': {}}
    for fixture_workspace in sorted({s.workspace_fixture_id for s in loaded.suite.sources}, key=str):
        name = f'Evaluation {loaded.suite.id}:{loaded.suite.version} {fixture_workspace}'
        existing = [w for w in workspaces if w['name'] == name]
        if len(existing) > 1:
            raise ValueError('Ambiguous evaluation workspace')
        workspace = existing[0] if existing else client.post('/api/workspaces',
            {'name': name, 'description': 'Fixed synthetic AI evaluation corpus. No private research data.'})
        workspace_id = str(UUID(workspace['id']))
        bindings['workspaces'][str(fixture_workspace)] = workspace_id
        route = f'/api/workspaces/{workspace_id}/sources'
        existing_sources = client.get(route)
        fixtures = [s for s in loaded.suite.sources if s.workspace_fixture_id == fixture_workspace]
        if any(s['originalFilename'] not in {Path(f.path).name for f in fixtures} for s in existing_sources):
            raise ValueError('Evaluation workspace contains sources outside fixed corpus')
        for source in fixtures:
            file = source_path(loaded.root, source)
            matches = [s for s in existing_sources if s['originalFilename'] == file.name]
            if len(matches) > 1:
                raise ValueError('Ambiguous evaluation source')
            uploaded = matches[0] if matches else client.upload(route, file)
            if uploaded['contentSha256'] != source.sha256:
                raise ValueError('Existing evaluation file differs; preserve it and version the suite')
            source_id = str(UUID(uploaded['id']))
            deadline = clock() + timeout
            while True:
                status = client.get(route + '/' + source_id)
                if status['status'] == 'READY':
                    break
                if status['status'] == 'FAILED' or clock() >= deadline:
                    raise ApiFailure()
                sleep(0.5)
            bindings['sources'][str(source.id)] = {'sourceId': source_id, 'workspaceId': workspace_id,
                'sourceVersionId': str(UUID(status['activeVersionId']))}
    return bindings


class SpringBackend:
    def __init__(self, loaded, config, client, bindings):
        if config.index != 'spring-hybrid' or bindings.get('schemaVersion') != '1.0' or any(
            bindings.get(key) != value for key, value in [('suiteHash', loaded.suite_hash), ('corpusHash', loaded.corpus_hash)]):
            raise ValueError('Invalid live evaluation binding/configuration')
        self.loaded, self.config, self.client, self.bindings = loaded, config, client, bindings
        if set(bindings['sources']) != {str(s.id) for s in loaded.suite.sources} or set(bindings['workspaces']) != {
                str(s.workspace_fixture_id) for s in loaded.suite.sources}:
            raise ValueError('Live bindings do not match fixed corpus')
        if len(set(bindings['workspaces'].values())) != len(bindings['workspaces']):
            raise ValueError('Distinct fixture workspaces must remain distinct')
        self.runtime_chunks, self.normalized_chunks, self.models = {}, {}, {}
        self.embedding_models, self._diagnostics = {}, []
        self.verify_corpus()

    def route(self, case):
        workspace = str(UUID(self.bindings['workspaces'][str(case.workspace_fixture_id)]))
        return f'/api/workspaces/{workspace}'

    def verify_corpus(self):
        for source in self.loaded.suite.sources:
            binding = self.bindings['sources'][str(source.id)]
            workspace, runtime_source = str(UUID(binding['workspaceId'])), str(UUID(binding['sourceId']))
            if workspace != self.bindings['workspaces'][str(source.workspace_fixture_id)]:
                raise ValueError('Live fixture workspace differs from source binding')
            route = f'/api/workspaces/{workspace}'
            source_route = f'{route}/sources/{runtime_source}'
            metadata = self.client.get(source_route)
            extraction = self.client.get(source_route + '/extraction')
            manifest = self.client.get(source_route + '/retrieval')
            if (metadata['status'] != 'READY' or metadata['contentSha256'] != source.sha256
                    or metadata['activeVersionId'] != binding['sourceVersionId'] or not extraction or not manifest
                    or digest(''.join(u['text'] for u in extraction['chunks'])) != source.extraction_sha256
                    or manifest['config'] != self.config.chunking.model_dump(mode='json', by_alias=True)):
                raise ValueError('Live corpus/version/chunk configuration drift')
            expected_units = self.loaded.extractions[source.id].chunks
            actual_units = extraction['chunks']
            for actual, expected in zip(actual_units, expected_units):
                for key in ('chunkId', 'text', 'pageNumber', 'characterStart', 'characterEnd'):
                    if actual[key] != expected.model_dump(by_alias=True)[key]:
                        raise ValueError('Live source extraction locations differ from fixed corpus')
            if len(actual_units) != len(expected_units):
                raise ValueError('Live source extraction unit count differs')
            expected_chunks = {c.chunk_id: c for c in self.loaded.chunks(self.config.chunking) if c.source_id == source.id}
            seen = set()
            for raw in manifest['chunks']:
                chunk = RetrievalChunk.model_validate(raw)
                if (str(chunk.workspace_id) != workspace or str(chunk.source_id) != runtime_source
                        or str(chunk.source_version_id) != binding['sourceVersionId']):
                    raise ValueError('Live chunk scope/version differs')
                normalized_id = identity_digest([str(source.workspace_fixture_id), str(source.id), None,
                    chunk.processing_version, chunk.chunk_index, chunk.content_hash,
                    [[s.unit_id, s.character_start, s.character_end] for s in chunk.spans]])
                normalized = chunk.model_copy(update={'source_id': source.id, 'workspace_id': source.workspace_fixture_id,
                    'source_version_id': None, 'chunk_id': normalized_id})
                if normalized_id in seen or expected_chunks.get(normalized_id) != normalized:
                    raise ValueError('Live retrieval chunks differ from parser-grounded fixed corpus')
                seen.add(normalized_id)
                self.runtime_chunks[chunk.chunk_id] = chunk
                self.normalized_chunks[chunk.chunk_id] = normalized
            if seen != set(expected_chunks):
                raise ValueError('Incomplete live retrieval corpus')
            model = self.client.get(route + '/ai/model')
            if workspace in self.models and self.models[workspace] != model:
                raise ValueError('Live model metadata changed during evaluation')
            self.models[workspace] = model
        for workspace in self.bindings['workspaces'].values():
            actual = {s['id'] for s in self.client.get(f'/api/workspaces/{workspace}/sources')}
            expected = {s['sourceId'] for s in self.bindings['sources'].values() if s['workspaceId'] == workspace}
            if actual != expected:
                raise ValueError('Live workspace contains sources outside fixed corpus')

    def verify_snapshot(self):
        # Multi-request evaluation must reject source/config/model changes during the run too.
        self.verify_corpus()

    def metadata(self):
        return {'adapter': 'spring-hybrid', 'productionIndex': True, 'sourceBindings': self.bindings['sources'],
            'chunkBindings': {c.chunk_id: runtime for runtime, c in self.normalized_chunks.items()},
            'models': self.models, 'templateId': self.config.template_id,
            'embeddingModels': self.embedding_models,
            'templateHash': digest(self.config.system_instruction),
            'questionRetrievalPolicy': 'server-owned; actual context recorded per answer'}

    def selected(self, case):
        return None if case.selected_source_ids is None else [self.bindings['sources'][str(id)]['sourceId'] for id in case.selected_source_ids]

    def retrieve(self, case):
        self._diagnostics = []
        selected = self.selected(case)
        # Spring's GET contract has no empty-selection representation.
        if selected == []:
            return []
        params = [('query', case.question), ('topK', str(self.config.top_k))]
        if selected is not None:
            params.extend(('sourceIds', id) for id in selected)
        hits = self.client.get(self.route(case) + '/retrieval/search?' + urlencode(params))
        result = []
        for hit in hits:
            chunk = RetrievalChunk.model_validate(hit['chunk'])
            if self.runtime_chunks.get(chunk.chunk_id) != chunk:
                raise ValueError('Live retrieval changed after corpus verification')
            model = EmbeddingMetadata.model_validate(hit['model'])
            workspace = self.bindings['workspaces'][str(case.workspace_fixture_id)]
            if workspace in self.embedding_models and self.embedding_models[workspace] != model.model_dump(mode='json', by_alias=True):
                raise ValueError('Live embedding namespace changed during evaluation')
            self.embedding_models[workspace] = model.model_dump(mode='json', by_alias=True)
            normalized = self.normalized_chunks[chunk.chunk_id]
            result.append(normalized)
            self._diagnostics.append(RetrievalDiagnostic(rank=len(result), chunk_id=normalized.chunk_id,
                score=hit['score'], vector_similarity=hit['vectorSimilarity'], lexical_score=hit['lexicalScore'], embedding_model=model))
        return result

    def retrieval_diagnostics(self):
        return self._diagnostics

    def answer(self, case, chunks):
        payload = self.client.post(self.route(case) + '/ai/questions',
            {'question': case.question, 'selectedSourceIds': self.selected(case)})
        generation = payload['generation']
        if generation is None:
            if payload['status'] != 'INSUFFICIENT_EVIDENCE' or payload['citations']:
                raise ValueError('Invalid no-generation answer')
            return AnswerObservation(answer=StructuredAnswer(status='INSUFFICIENT_EVIDENCE', claims=[]), provided_chunks=[],
                template_id=self.config.template_id, template_hash=digest(self.config.system_instruction), latency_ms=0)
        result = GenerationResult.model_validate(generation['result'])
        workspace = self.bindings['workspaces'][str(case.workspace_fixture_id)]
        if result.model.model_dump(mode='json', by_alias=True) != self.models[workspace]:
            raise ValueError('Live answer model differs from pinned metadata')
        if result.template_id != self.config.template_id or result.template_hash != digest(self.config.system_instruction):
            raise ValueError('Live prompt identity differs from requested evaluation configuration')
        provided = []
        mapping = {}
        for citation in generation['evidence']:
            runtime = citation['chunkId']
            original = self.runtime_chunks.get(runtime)
            if original is None:
                raise ValueError('Model context outside fixed corpus')
            for key in ('workspaceId', 'sourceId', 'sourceVersionId', 'contentHash', 'processingVersion', 'pageStart', 'pageEnd', 'spans'):
                if citation[key] != original.model_dump(mode='json', by_alias=True)[key]:
                    raise ValueError('Model context provenance drift')
            provided.append(self.normalized_chunks[runtime])
            mapping[runtime] = self.normalized_chunks[runtime].chunk_id
        if payload['status'] != result.answer.status or any(id not in mapping for claim in result.answer.claims for id in claim.evidence_ids):
            raise ValueError('Invalid live answer citation')
        answer = result.answer.model_dump()
        for claim in answer['claims']:
            claim['evidence_ids'] = [mapping[id] for id in claim['evidence_ids']]
        return AnswerObservation(answer=answer, provided_chunks=provided, usage=result.usage,
            model={'provider': result.model.provider, 'name': result.model.name, 'version': result.model.version},
            template_id=result.template_id, template_hash=result.template_hash, latency_ms=0)
