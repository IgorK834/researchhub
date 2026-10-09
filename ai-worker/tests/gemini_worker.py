"""Spring E2E fixture. Real native adapters; only the Google endpoint is simulated.

Known synthetic answers/programs are fixtures, not measurements of Gemini quality.
TLS is routed to loopback only in this test process, never in production configuration.
"""
import json
import os
from http.client import HTTPConnection
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
from types import SimpleNamespace
from urllib.request import HTTPSHandler, build_opener

import uvicorn

from researchhub_worker.ai.gemini import GeminiModelProvider
from researchhub_worker.ai.providers import ModelGateway, _NoRedirect
from researchhub_worker.ai.source_analysis import fake_answer
from researchhub_worker.analysis.contracts import PlanningRequest
from researchhub_worker.analysis.deterministic import impedance_plan
from researchhub_worker.retrieval.gemini import GeminiEmbeddingProvider
from researchhub_worker.retrieval.embeddings import BatchedEmbeddingProvider
from researchhub_worker.ai.gemini_http import embedding_batch_size
from researchhub_worker.server import create_app


def answer(body):
    user = json.loads(body['contents'][0]['parts'][0]['text'])
    system = body['systemInstruction']['parts'][0]['text']
    if 'researchhub_computation_plan_v1' in system:
        user.pop('evidenceTrust')
        user.pop('executionProtocol')
        return json.dumps(impedance_plan(PlanningRequest.model_validate(user)))
    lines = user['context'].split('\n') if user['context'] else []
    blocks = [json.loads(line) for line in lines[1::2]]
    keys = [line[1:-1] for line in lines[::2]]
    if 'researchhub_authoring_v1' in system:
        fields = json.loads(user['instruction'])
        if fields['kind'] == 'EVIDENCE':
            return json.dumps({'status': 'READY', 'text': '', 'citationKeys': [], 'matches': [
                {'citationKey': key, 'category': 'supporting', 'relevance': 1.0, 'reason': 'Synthetic supplied evidence.'}
                for key in keys[:4]]})
        text = blocks[0]['text'][:500] if blocks else fields['selectedText']
        return json.dumps({'status': 'READY', 'text': text, 'citationKeys': keys[:1], 'matches': []})
    if 'researchhub_source_analysis_v1' in system:
        contextual = SimpleNamespace(blocks=lambda: [SimpleNamespace(source_id=b['sourceId']) for b in blocks],
            request=SimpleNamespace(evidence=[SimpleNamespace(content=b['text']) for b in blocks]),
            context=SimpleNamespace(summary=SimpleNamespace(citations=[SimpleNamespace(citation_key=k) for k in keys])))
        return fake_answer(contextual, json.loads(user['instruction'])).model_dump_json(by_alias=True)
    if user['instruction'] == 'invalid-output-fixture':
        return 'invalid JSON'
    missing = any(term in user['instruction'].lower() for term in ('unrecorded', 'zebra', 'humidity'))
    return json.dumps({'status': 'INSUFFICIENT_EVIDENCE' if missing else 'SUPPORTED', 'claims': [] if missing else [
        {'text': block.get('text', block.get('content', 'Synthetic computed output'))[:500], 'citationKeys': [key]}
        for key, block in zip(keys[:4], blocks[:4])]})


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        assert self.headers['x-goog-api-key'] == 'fixture-private-key'
        assert '?' not in self.path
        if self.path.endswith(':batchEmbedContents'):
            assert all(r['outputDimensionality'] == 768 for r in body['requests'])
            payload = {'embeddings': [{'values': [0.12345678901234567] * 768} for _ in body['requests']]}
        else:
            assert body['store'] is False and not {'tools', 'toolConfig', 'cachedContent'} & body.keys()
            payload = {'responseId': 'fixture-native-response', 'modelVersion': 'gemini-3.8-flash',
                'candidates': [{'finishReason': 'STOP', 'content': {'role': 'model', 'parts': [{'text': answer(body)}]}}],
                'usageMetadata': {'promptTokenCount': 40, 'candidatesTokenCount': 10, 'thoughtsTokenCount': 5, 'totalTokenCount': 55}}
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps(payload).encode())


server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
thread = Thread(target=server.serve_forever, daemon=True)
thread.start()


class LoopbackTransport(HTTPSHandler):
    def https_open(self, request):
        assert request.host == 'fixture.invalid'
        return self.do_open(lambda host, **kwargs: HTTPConnection('127.0.0.1', server.server_port, **kwargs), request)


opener = build_opener(_NoRedirect, LoopbackTransport)
model = GeminiModelProvider('fixture-private-key', base_url='https://fixture.invalid/v1beta', opener=opener)
vectors = GeminiEmbeddingProvider('fixture-private-key', base_url='https://fixture.invalid/v1beta', opener=opener)
try:
    uvicorn.run(create_app(model_gateway=ModelGateway(model),
        embedding_provider=BatchedEmbeddingProvider(vectors, batch_size=embedding_batch_size(768))),
        host='127.0.0.1', port=int(os.environ['AI_WORKER_PORT']), access_log=False)
finally:
    server.shutdown()
    server.server_close()
    thread.join()
