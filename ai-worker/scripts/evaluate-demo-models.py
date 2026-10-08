#!/usr/bin/env python3
"""RH-346 development harness: ephemeral loopback TLS to an existing Ollama runtime."""
import argparse
import http.client
import json
import os
from pathlib import Path
import ssl
import subprocess
import tempfile
from threading import Thread
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.request import urlopen, Request

from researchhub_worker.evaluation.__main__ import FIXTURES
from researchhub_worker.evaluation.contracts import RunConfig
from researchhub_worker.evaluation.corpus import load_suite
from researchhub_worker.evaluation.models import Matrix, evaluate, gateway
from researchhub_worker.evaluation.report import write_json

ROOT = Path(__file__).resolve().parents[2]


def local_api(path, payload=None):
    request = Request('http://127.0.0.1:11434' + path,
        data=json.dumps(payload).encode() if payload is not None else None,
        headers={'Content-Type': 'application/json'})
    with urlopen(request, timeout=60) as response:
        return json.load(response)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--matrix', type=Path, default=ROOT / 'docs/evaluation/models/demo-matrix.json')
    parser.add_argument('--output', type=Path, default=ROOT / 'docs/evaluation/results/demo-models')
    args = parser.parse_args()
    matrix = Matrix.model_validate_json(args.matrix.read_text())
    models = {m['name']: m['digest'] for m in local_api('/api/tags')['models']}
    version = local_api('/api/version')['version']
    if version != '0.30.10':
        raise ValueError('The matrix requires Ollama 0.30.10; review and re-version for another runtime')
    for candidate in matrix.candidates:
        if candidate.id in ('qwen-local', 'gemma-local') and models.get(candidate.model) != candidate.version:
            raise ValueError('Local digest differs; install the pinned model before evaluating')
    with tempfile.TemporaryDirectory(prefix='researchhub-evaluation-tls-') as directory:
        cert, key = Path(directory) / 'cert.pem', Path(directory) / 'key.pem'
        subprocess.run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
            '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost', '-keyout', str(key), '-out', str(cert)],
            check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        # Optional hosted candidates retain the public trust roots, never verification=False.
        bundle = Path(directory) / 'ca-bundle.pem'
        public = ssl.create_default_context().get_ca_certs(binary_form=True)
        bundle.write_text(''.join(ssl.DER_cert_to_PEM_cert(c) for c in public) + cert.read_text())
        os.environ['SSL_CERT_FILE'] = str(bundle)
        os.environ['RH_LOCAL_MODEL_KEY'] = 'local-evaluation-only'

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_POST(self):
                if self.path != '/v1/chat/completions' or self.headers.get('Authorization') != 'Bearer local-evaluation-only':
                    self.send_response(404)
                    self.end_headers()
                    return
                count = int(self.headers.get('Content-Length', '0'))
                if not 0 < count <= 512 * 1024:
                    self.send_response(413)
                    self.end_headers()
                    return
                data = self.rfile.read(count)
                connection = http.client.HTTPConnection('127.0.0.1', 11434, timeout=8)
                try:
                    # Pass body and response unchanged. No fake output or format translation.
                    connection.request('POST', self.path, data, {'Content-Type': 'application/json'})
                    response = connection.getresponse()
                    raw = response.read(256 * 1024 + 1)
                    self.send_response(response.status)
                    self.send_header('Content-Type', 'application/json')
                    self.end_headers()
                    self.wfile.write(raw)
                except OSError:
                    try:
                        self.send_response(504)
                        self.end_headers()
                    except OSError:
                        pass
                finally:
                    connection.close()

        server = ThreadingHTTPServer(('127.0.0.1', 11435), Handler)
        tls = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        tls.load_cert_chain(cert, key)
        server.socket = tls.wrap_socket(server.socket, server_side=True)
        thread = Thread(target=server.serve_forever, daemon=True)
        thread.start()
        snapshots = {}

        def factory(candidate):
            if candidate.id in ('qwen-local', 'gemma-local'):
                local_api('/api/generate', {'model': candidate.model, 'prompt': 'JSON', 'stream': False,
                    'options': {'num_predict': 1}, 'keep_alive': '10m'})
                snapshots[candidate.id] = local_api('/api/ps')
            model = gateway(candidate)
            if model is not None:
                original = model.generate_structured
                count = 0
                def measured(request):
                    nonlocal count
                    count += 1
                    try:
                        return original(request)
                    finally:
                        if count % 5 == 0:
                            print(candidate.id + ': observation ' + str(count), flush=True)
                model.generate_structured = measured
            return model

        try:
            result = evaluate(load_suite(FIXTURES / 'suite.json'), RunConfig.model_validate_json((FIXTURES / 'baseline.json').read_text()),
                matrix, args.output, factory=factory)
            result['environment'] = {'ollama': version, 'architecture': os.uname().machine,
                'localModels': models, 'warmupExcluded': True, 'runtimeSnapshots': snapshots}
            write_json(args.output / 'models.json', result)
        finally:
            server.shutdown()
            server.server_close()
            thread.join()
    return 0 if result['preferredAccepted'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
