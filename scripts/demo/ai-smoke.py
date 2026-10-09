#!/usr/bin/env python3
"""Live Gemini E2E through the public product API, using authored synthetic data.

No provider key is read here. Spring owns authorization, persistence, source scope,
approved edits and the isolated executor. Test objects stay in a separate workspace.
"""
import argparse
from contextlib import contextmanager, nullcontext
import fcntl
import hashlib
import json
import math
import os
import ssl
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from uuid import uuid4

from api import ApiError, Client, save_private, wait_for
import stack
from stack import STATE, URL

CLAIM = 'Impedance equals voltage divided by current.'
FILES = {'gemini-law.txt': CLAIM + '\nFor these measurements Z = U/I in ohms. No humidity was recorded.\n',
    'gemini-method-a.txt': 'Method: randomized controlled trial\nMain result: 80%\n',
    'gemini-method-b.txt': 'Method: observational cohort\nMain result: 60%\n',
    'gemini-data.csv': 'frequency [Hz],voltage [V],current [A]\n' + ''.join(f'{i * 100},{i * 2},0.5\n' for i in range(1, 66))}


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


class SmokeClient(Client):
    def request(self, *args, **kwargs):
        # Spring rejects a quota-limited operation before calling AI or mutating
        # state. Respect its bounded window, without retrying provider failures.
        for attempt in range(3):
            try:
                return super().request(*args, **kwargs)
            except ApiError as error:
                if (attempt == 2 or error.status != 429 or error.code != 'RATE_LIMIT_EXCEEDED'
                        or error.retry_after_seconds is None):
                    raise
                print('Application quota: waiting ' + str(error.retry_after_seconds) + 's', flush=True)
                time.sleep(error.retry_after_seconds)


@contextmanager
def local_quota_window():
    """Temporarily shorten the managed local demo's 10-request quota window.

    Keep the same limits, authorization and PostgreSQL quota store. Restore the
    original process environment and demo backend even after a failed check.
    """
    with (STATE / 'stack.lock').open('w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        require(stack.managed_pid() is not None, 'Start the managed local demo before verification')
        values = stack.credentials()
        name = 'RESEARCHHUB_SECURITY_QUOTAS_WINDOW'
        original = os.environ.get(name)
        try:
            os.environ[name] = 'PT1M'
            stack.stop_backend()
            stack.start_backend(values)
            yield
        finally:
            if original is None:
                os.environ.pop(name, None)
            else:
                os.environ[name] = original
            stack.stop_backend()
            stack.start_backend(values)


def main():
    report = {'date': datetime.now(timezone.utc).isoformat(), 'provider': 'gemini',
        'datasetSha256': hashlib.sha256(json.dumps(FILES, sort_keys=True).encode()).hexdigest(), 'stages': []}
    def stage(name, operation):
        start = time.perf_counter()
        try:
            value = operation()
            report['stages'].append({'name': name, 'passed': True, 'latencyMs': (time.perf_counter() - start) * 1000})
            save_private(STATE / 'gemini-live-smoke.json', report)
            print(name + ': PASS', flush=True)
            return value
        except Exception as error:
            report['stages'].append({'name': name, 'passed': False, 'errorType': type(error).__name__,
                'httpStatus': getattr(error, 'status', None), 'errorCode': getattr(error, 'code', None),
                'latencyMs': (time.perf_counter() - start) * 1000})
            save_private(STATE / 'gemini-live-smoke.json', report)
            raise
    client = SmokeClient(URL, ssl_context=ssl.create_default_context(cafile=str(STATE / 'root.crt')))
    client.login(json.loads((STATE / 'accounts.json').read_text())['accounts']['owner'])
    workspace = next((w for w in client.get('/api/workspaces') if w['name'] == 'Native Gemini E2E'), None)
    workspace = workspace or client.post('/api/workspaces', {'name': 'Native Gemini E2E', 'description': 'Authored synthetic AI verification fixtures.'})
    base = '/api/workspaces/' + workspace['id']
    metadata = client.get(base + '/ai/model')
    require(metadata['provider'] == 'gemini', 'Start the demo with Gemini before this smoke test')
    report.update(model=metadata, workspaceId=workspace['id'])
    sources = {s['originalFilename']: s for s in client.get(base + '/sources')}
    fixture_dir = STATE / 'gemini-smoke-fixtures'
    fixture_dir.mkdir(exist_ok=True)
    def ingest():
        for name, text in FILES.items():
            file = fixture_dir / name
            file.write_text(text)
            source = sources.get(name) or client.upload(base + '/sources', file)
            require(source['contentSha256'] == hashlib.sha256(text.encode()).hexdigest(), 'Preserve edited fixture source')
            source = wait_for(lambda: client.get(base + '/sources/' + source['id']),
                lambda item: item['status'] in ('READY', 'FAILED'), timeout=300)
            require(source['status'] == 'READY', 'Source must be indexed before AI verification')
            sources[name] = source
    stage('upload-and-native-embedding-index', ingest)
    law = sources['gemini-law.txt']['id']
    def question(text):
        return client.post(base + '/ai/questions', {'question': text, 'selectedSourceIds': [law]})
    def grounded():
        value = question('What relation between voltage, current and impedance is stated in the source?')
        require(value['status'] == 'SUPPORTED' and value['citations'] and all(c['sourceId'] == law for c in value['citations']), 'Grounded source scope')
    stage('source-scoped-grounded-question', grounded)
    def refusal():
        value = question('What was the measured humidity percentage?')
        require(value['status'] == 'INSUFFICIENT_EVIDENCE' and not value['citations'], 'Correct refusal')
    stage('correct-refusal', refusal)
    conversation = client.post(base + '/ai/conversations', {'title': 'Native Gemini E2E'})
    route = base + '/ai/conversations/' + conversation['id']
    message = {'clientRequestId': str(uuid4()), 'question': 'State the impedance equation', 'selectedSourceIds': [law]}
    def conversation_test():
        first = client.post(route + '/messages', message)
        require(first == client.post(route + '/messages', message), 'Idempotent conversation retry')
        require(first['assistant']['status'] == 'COMPLETED' and len(client.get(route)['messages']) == 2, 'Persisted history')
        token = next(c.value for c in client.jar if c.name == 'XSRF-TOKEN')
        body = {**message, 'clientRequestId': str(uuid4())}
        request = urllib.request.Request(URL + route + '/messages/stream', data=json.dumps(body).encode(), method='POST',
            headers={'Content-Type': 'application/json', 'X-XSRF-TOKEN': urllib.parse.unquote(token)})
        with client.opener.open(request, timeout=180) as response:
            stream = response.read(1024 * 1024 + 1)
        require(len(stream) <= 1024 * 1024 and b'event:completed' in stream.replace(b'event: ', b'event:'), 'Validated SSE completion')
    stage('conversation-history-idempotency-and-sse', conversation_test)
    anchor = str(uuid4())
    document = client.post(base + '/documents', {'title': 'Native Gemini smoke ' + str(uuid4())[:8], 'content': {
        'type': 'doc', 'content': [{'type': 'paragraph', 'content': [{'type': 'text', 'text': CLAIM,
            'marks': [{'type': 'commentAnchor', 'attrs': {'ids': [anchor]}}]}]}]}})
    doc = base + '/documents/' + document['id']
    suggestions = doc + '/ai/suggestions'
    def command(kind, action=None):
        revision = client.get(doc)['revision']
        return {'kind': kind, 'expectedRevision': revision, 'placementBlock': 1 if kind == 'DRAFT' else None,
            'from': None if kind == 'DRAFT' else 1, 'to': None if kind == 'DRAFT' else len(CLAIM) + 1,
            'action': action, 'instruction': 'Explain the impedance equation using the supplied evidence.',
            'selectedSourceIds': [law] if kind != 'REWRITE' else [], 'lengthTarget': 100,
            'stylePreset': 'ACADEMIC', 'citationRequired': kind == 'DRAFT'}
    def draft():
        value = client.post(suggestions, command('DRAFT'))
        require(value['generation']['model']['provider'] == 'gemini' and value['citations'], 'Cited native draft')
        client.post(suggestions + '/' + value['id'] + '/accept', {'expectedRevision': document['revision']})
        require(client.get(doc)['revision'] > document['revision'], 'Accepted draft persistence')
    stage('draft-accept-and-citation-provenance', draft)
    for action in ('IMPROVE_ACADEMIC_STYLE', 'SHORTEN', 'EXPAND', 'CLARIFY', 'FIX_GRAMMAR', 'EXPLAIN'):
        def rewrite(action=action):
            value = client.post(suggestions, command('REWRITE', action))
            require(value['generation']['model']['provider'] == 'gemini' and value['generatedText'], 'Native rewrite result')
            client.post(suggestions + '/' + value['id'] + '/reject')
        stage('rewrite-' + action.lower(), rewrite)
    def evidence():
        value = client.post(suggestions, command('EVIDENCE'))
        candidate = next(c for c in value['candidates'] if c['category'] == 'supporting')
        client.post(suggestions + '/' + value['id'] + '/accept', {'expectedRevision': client.get(doc)['revision'],
            'citationChunkId': candidate['citation']['chunkId']})
        return candidate['citation']['chunkId']
    cited = stage('find-evidence-and-insert-citation', evidence)
    def comment_ai():
        comment = client.post(doc + '/comments', {'id': str(uuid4()), 'body': 'Verify this equation.',
            'anchor': {'strategy': 'TEXT_MARK_V1', 'id': anchor, 'quote': CLAIM}})
        comment_path = doc + '/comments/' + comment['id']
        updated = client.post(comment_path + '/ai-evidence', {'id': str(uuid4())})
        suggestion = updated['aiSuggestions'][-1]
        require(any(c['citation']['chunkId'] == cited and c['category'] != 'insufficient'
            for c in suggestion['evidence']['candidates']), 'Comment evidence agrees with saved citation')
        accepted = client.post(comment_path + '/ai-evidence/' + suggestion['id'] + '/accept', {'chunkId': cited})
        require(cited in accepted['aiSuggestions'][-1]['acceptedChunkIds'] and accepted['status'] == 'OPEN', 'Durable comment receipt')
    stage('comment-ai-evidence-and-acceptance', comment_ai)
    def comparisons():
        value = client.post(base + '/ai/source-analyses/comparisons', {'selectedSourceIds':
            [sources[n]['id'] for n in ('gemini-method-a.txt', 'gemini-method-b.txt')],
            'criteria': ['method', 'main result'], 'instruction': 'Compare only the explicit fields.'})
        require(value['answer']['status'] == 'READY' and value['generation']['model']['provider'] == 'gemini', 'Comparison')
        followup = client.post(base + '/ai/source-analyses/' + value['id'] + '/disagreements', {'instruction': 'Identify potential differences without asserting certain contradictions.'})
        require(followup['answer']['findings'] and followup['generation']['model']['provider'] == 'gemini', 'Disagreement')
    stage('source-comparison-and-potential-disagreements', comparisons)
    data = sources['gemini-data.csv']
    analysis = client.post(base + '/analyses', {'userPrompt': 'Read ALL rows from the immutable CSV (not preview rows). Calculate Z=U/I in ohms for every row. Return TABLE impedance-table with frequency_hz, voltage_v, current_a, impedance_ohm columns and a CHART impedance-chart plotting impedance_ohm against frequency_hz. Do not fit or filter data.',
        'inputs': [{'sourceId': data['id'], 'sourceVersionId': data['activeVersionId'], 'sheetName': 'CSV', 'columns': [1, 2, 3]}]})
    analysis_path = base + '/analyses/' + analysis['id']
    def plan():
        value = client.post(analysis_path + '/plan')
        require(value['status'] == 'READY_TO_EXECUTE' and {o['name'] for o in value['plan']['outputs']} == {'impedance-table', 'impedance-chart'}, 'Native approved plan')
    stage('native-computation-plan', plan)
    def completed(attempt):
        value = wait_for(lambda: client.get(analysis_path + '/executions/' + attempt['id']),
            lambda item: item['status'] in ('SUCCEEDED', 'FAILED'), timeout=180)
        require(value['status'] == 'SUCCEEDED', 'Real sandbox execution')
        table = next(o for o in value['result']['outputs'] if o['kind'] == 'TABLE')
        require(len(table['rows']) == 65 and any(isinstance(v, (int, float)) and math.isclose(v, 260, abs_tol=1e-9) for v in table['rows'][-1]), 'Full immutable dataset, independently expected Z=260')
        require(value['provenance']['imageId'] and value['provenance']['codeSha256'] and value['provenance']['inputs'][0]['sha256'] == data['contentSha256'], 'Execution provenance')
        record = client.get(analysis_path + '/executions/' + value['id'] + '/record')
        require(record['charts'] and record['charts'][0]['series'][0]['pointCount'] == 65, 'Persisted chart provenance')
        return value
    execution = stage('full-data-sandbox-table-and-chart', lambda: completed(client.post(analysis_path + '/execute')))
    def rerun():
        attempt = client.post(analysis_path + '/executions/' + execution['id'] + '/rerun', {'inputMode': 'ORIGINAL'})
        value = completed(attempt['execution'])
        require(value['provenance']['codeSha256'] == execution['provenance']['codeSha256'], 'Reproduction uses accepted code')
    stage('reproduce-original-execution', rerun)
    def computed_question():
        value = client.post(base + '/ai/questions', {'question': 'How many measurements were computed and what is the impedance at the last measured frequency?', 'selectedSourceIds': [],
            'selectedAnalysisOutputs': [{'analysisId': analysis['id'], 'executionId': execution['id'], 'outputId': 'impedance-table'}]})
        require(value['status'] == 'SUPPORTED' and value['analysisCitations'] and '260' in value['answer'], 'Cited actual computation')
    stage('question-on-persisted-computation', computed_question)
    report['passed'] = True
    save_private(STATE / 'gemini-live-smoke.json', report)
    print('Live Gemini E2E PASS. Report: .demo/local/gemini-live-smoke.json')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--local-quota-window', action='store_true',
        help='Temporarily use a one-minute quota window in the managed local demo; restore it afterward.')
    options = parser.parse_args()
    try:
        with local_quota_window() if options.local_quota_window else nullcontext():
            main()
    except (ApiError, RuntimeError, OSError, KeyError, StopIteration, TypeError):
        print('Live Gemini E2E failed; see the safe stage report in .demo/local/gemini-live-smoke.json')
        raise SystemExit(1)
