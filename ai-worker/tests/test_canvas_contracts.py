"""Shared UTF-16/UTF-8 fixtures. Canvas foundation never calls the model worker."""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2] / 'contracts/ai/canvas/v1'

def test_canvas_unicode_offsets_use_utf16_not_python_codepoints():
    fixture = json.loads((ROOT / 'unicode.json').read_text())
    text = fixture['content']['content'][0]['content'][0]['text']
    raw = text.encode('utf-16-le')
    target = fixture['capture']['target']
    selected = raw[target['start']['offset'] * 2:target['end']['offset'] * 2].decode('utf-16-le')
    assert selected == fixture['snapshot']['text'] == 'A😀B'
    assert len(raw) // 2 == fixture['utf16Length']
    assert hashlib.sha256(selected.encode()).hexdigest() == target['hash']
    assert len(selected) != target['end']['offset'] - target['start']['offset']

def test_future_contracts_keep_user_content_and_computed_evidence_explicit():
    schema = json.loads((ROOT / 'canvas.schema.json').read_text())
    assert schema['$defs']['Intent']['enum'] == ['ANSWER', 'EDIT', 'ANALYZE', 'SOLVE', 'CLARIFY']
    assert schema['$defs']['TrustEntry']['properties']['role']['enum'] == [
        'USER_INPUT', 'SOURCE_EVIDENCE', 'COMPUTED_RESULT', 'MODEL_EXPLANATION']
    for name in ['capture', 'context', 'firstturn', 'turn', 'turnstate', 'proposal', 'execution', 'accept', 'receipt']:
        payload = json.loads((ROOT / f'{name}.json').read_text())
        assert payload['schemaVersion'] == '1.0'
        assert 'apiKey' not in payload and 'thoughts' not in payload
    assert json.loads((ROOT / 'execution.json').read_text())['workload'] == 'PROBLEM'
