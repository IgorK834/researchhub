from __future__ import annotations

import hashlib
import json
from pathlib import Path
import pytest
from researchhub_worker.ai.context import ContextualRequest
from researchhub_worker.ai.providers import FakeModelProvider, ModelGateway
from test_ai_context import repack
from test_ai import cloud, cloud_payload

FIXTURES = Path(__file__).resolve().parents[2] / 'contracts' / 'ai' / 'questions' / 'v1'


def payload():
    return json.loads((FIXTURES / 'model-request.json').read_text())


def test_question_template_fixture_is_deterministic_and_records_real_context_keys():
    request = ContextualRequest.model_validate(payload())
    result = ModelGateway(FakeModelProvider()).generate_structured(request)
    assert result == ModelGateway(FakeModelProvider()).generate_structured(request)
    assert result.model_dump(mode='json', by_alias=True) == json.loads((FIXTURES / 'model-result.json').read_text())
    assert result.answer.claims[0].text == request.request.evidence[0].content
    assert result.answer.claims[0].evidence_ids == [request.context.summary.citations[0].chunk_id]


@pytest.mark.parametrize('question', ['What is the capital of Atlantis?', 'How?', 'Who invented unicorns?'])
def test_fake_question_policy_returns_no_claims_for_unrelated_or_empty_question_terms(question):
    p = payload()
    p['request']['instruction'] = question
    block = json.loads(p['context']['text'].split('\n')[1])
    request = ContextualRequest.model_validate(repack(p, [block]))
    result = ModelGateway(FakeModelProvider()).generate_structured(request)
    assert result.answer.status == 'INSUFFICIENT_EVIDENCE' and result.answer.claims == []


def test_fake_preserves_original_local_keys_when_only_later_chunk_supports_question():
    p = payload()
    original = json.loads(p['context']['text'].split('\n')[1])
    unrelated = dict(original, chunkId='b' * 64, text='A zebra eats grass.')
    p['request']['evidence'].insert(0, {'chunkId':unrelated['chunkId'],
        'contentHash':hashlib.sha256(unrelated['text'].encode()).hexdigest(), 'content':unrelated['text']})
    p['context']['summary']['citations'] = [{'citationKey':'S1','chunkId':'b'*64,'textReference':None},
        {'citationKey':'S2','chunkId':'a'*64,'textReference':None}]
    request = ContextualRequest.model_validate(repack(p,[unrelated,original]))
    result = ModelGateway(FakeModelProvider()).generate_structured(request)
    assert len(result.answer.claims) == 1 and result.answer.claims[0].evidence_ids == ['a'*64]


def test_foundry_receives_the_question_policy_and_can_return_insufficient_evidence():
    response = cloud_payload()
    response['choices'][0]['message']['content'] = json.dumps({'status':'INSUFFICIENT_EVIDENCE','claims':[]})
    provider, opener = cloud(json.dumps(response).encode())
    request = ContextualRequest.model_validate(payload())
    result = ModelGateway(provider).generate_structured(request)
    assert result.answer.status == 'INSUFFICIENT_EVIDENCE' and result.answer.claims == []
    outbound = json.loads(opener.open.call_args.args[0].data)
    assert outbound['messages'][0]['content'] == request.request.system_instruction
    assert json.loads(outbound['messages'][1]['content'])['instruction'] == request.request.instruction
    assert 'tools' not in outbound
