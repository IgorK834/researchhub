"""Spring E2E subprocess fixture: real adapters and HTTP, test-only HTTPS routing to loopback."""
import json
import os
from http.client import HTTPConnection
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
from urllib.request import HTTPSHandler, build_opener

import uvicorn

from researchhub_worker.ai.providers import OpenAiCompatibleModelProvider, ModelGateway, _NoRedirect
from researchhub_worker.ai.contracts import ModelMetadata
from researchhub_worker.retrieval.embeddings import OpenAiCompatibleEmbeddingProvider, BatchedEmbeddingProvider, ModelMetadata as VectorModel
from researchhub_worker.server import create_app


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        assert self.headers['Authorization'] == 'Bearer fixture-private-key'
        if self.path == '/v1/embeddings':
            assert body['dimensions'] == 2
            payload = {'model':'fixture-embedding', 'data':[{'index':i, 'embedding':[1,0]} for i in range(len(body['input']))]}
            status = 200
        else:
            assert body['store'] is False and body['stream'] is False and 'tools' not in body
            if body['response_format']['type'] == 'json_schema':
                status, payload = 400, {'error':{'param':'response_format','code':'unsupported_parameter'}}
            else:
                user = json.loads(body['messages'][1]['content'])
                invalid = user['instruction'] == 'invalid-output-fixture'
                block = json.loads(user['context'].split('\n')[1])
                content = 'invalid JSON' if invalid else json.dumps({'status':'SUPPORTED',
                    'claims':[{'text':block['text'][:500], 'citationKeys':['S1']}]})
                status, payload = 200, {'id':'fixture-response', 'model':'fixture-chat',
                    'choices':[{'finish_reason':'stop','message':{'content':content}}],
                    'usage':{'prompt_tokens':40,'completion_tokens':10,'total_tokens':50}}
        self.send_response(status)
        self.send_header('Content-Type','application/json')
        self.end_headers()
        self.wfile.write(json.dumps(payload).encode())


server = ThreadingHTTPServer(('127.0.0.1',0),Handler)
thread = Thread(target=server.serve_forever,daemon=True)
thread.start()


class LoopbackTransport(HTTPSHandler):
    def https_open(self, request):
        assert request.host == 'fixture.invalid'
        return self.do_open(lambda host,**kwargs:HTTPConnection('127.0.0.1',server.server_port,**kwargs),request)


opener = build_opener(_NoRedirect,LoopbackTransport)
model = OpenAiCompatibleModelProvider('https://fixture.invalid/v1','fixture-private-key','fixture-chat',
    ModelMetadata(provider='openai-compatible',name='fixture-chat',version='fixture-1'),opener)
vectors = OpenAiCompatibleEmbeddingProvider('https://fixture.invalid/v1','fixture-private-key',
    VectorModel(provider='openai-compatible',name='fixture-embedding',version='fixture-1',dimension=2),opener)
try:
    uvicorn.run(create_app(model_gateway=ModelGateway(model),embedding_provider=BatchedEmbeddingProvider(vectors)),
        host='127.0.0.1',port=int(os.environ['AI_WORKER_PORT']),access_log=False)
finally:
    server.shutdown()
    server.server_close()
    thread.join()
