from __future__ import annotations
from researchhub_worker.ai.safety import EVIDENCE_POLICY
import io
import json
import hashlib
from pathlib import Path
from unittest.mock import Mock
from urllib.error import HTTPError
import pytest
from fastapi.testclient import TestClient
from researchhub_worker.ai.authoring import LocalAuthoringAnswer, instruction, AuthoringResult
from researchhub_worker.ai.context import ContextualRequest
from researchhub_worker.ai.providers import FakeModelProvider, ModelGateway, ProviderError
from researchhub_worker.server import create_app
from test_ai import cloud, cloud_payload, AUTH, TOKEN
from test_ai_context import payload, repack


def command(kind='DRAFT', action=None, evidence=True, required=False, selected='Human claim.'):
    p=payload()
    template=Path('../backend/src/main/resources/ai/templates')/f'authoring-{kind.lower()}-v1.txt'
    system=template.read_text()
    p['request'].update(templateId=f'authoring-{kind.lower()}:1',systemInstruction=system,templateHash=hashlib.sha256(system.encode()).hexdigest(),
        instruction=json.dumps({'kind':kind,'action':action,'instruction':'Write the theory','selectedText':selected,'surroundingContext':'bounded context',
                                'citationRequired':required,'stylePreset':'ACADEMIC','lengthTarget':300},separators=(',',':')))
    blocks=[json.loads(p['context']['text'].split('\n')[1])]
    if not evidence:
        blocks=[];p['request']['evidence']=[];p['context']['summary']['citations']=[]
    return ContextualRequest.model_validate(repack(p,blocks))


def test_draft_only_cites_retrieved_evidence_and_retains_audit():
    gateway=ModelGateway(FakeModelProvider());request=command(required=True)
    result=gateway.generate_authoring(request)
    assert result.answer.citation_ids==['a'*64]
    assert result.template_hash==request.request.template_hash and result.usage.estimated
    assert result==gateway.generate_authoring(request)
    assert gateway.generate_authoring(command(evidence=False)).answer.status=='INSUFFICIENT_EVIDENCE'


@pytest.mark.parametrize('action',['IMPROVE_ACADEMIC_STYLE','SHORTEN','EXPAND','CLARIFY','FIX_GRAMMAR','EXPLAIN'])
def test_rewrites_work_without_sources_and_are_bounded(action):
    result=ModelGateway(FakeModelProvider()).generate_authoring(command('REWRITE',action,evidence=False,selected='human   claim needs review'))
    assert result.answer.status=='READY' and result.answer.citation_ids==[]
    if action=='SHORTEN':assert len(result.answer.text)<len('human   claim needs review')
    if action=='FIX_GRAMMAR':assert result.answer.text=='Human claim needs review.'


def test_grounded_expansion_and_insufficiency():
    gateway=ModelGateway(FakeModelProvider())
    assert gateway.generate_authoring(command('REWRITE','EXPAND')).answer.citation_ids==['a'*64]
    assert gateway.generate_authoring(command('REWRITE','EXPAND',required=True)).answer.citation_ids==['a'*64]
    assert gateway.generate_authoring(command('REWRITE','EXPAND',evidence=False,required=True)).answer.status=='INSUFFICIENT_EVIDENCE'


@pytest.mark.parametrize('claim,category',[('kinetic energy','supporting'),('energy unrelatedword','related'),('zzzzz','insufficient')])
def test_evidence_categories_do_not_confuse_topic_overlap_with_support(claim,category):
    result=ModelGateway(FakeModelProvider()).generate_authoring(command('EVIDENCE',selected=claim))
    assert result.answer.text=='' and result.answer.citation_ids==[]
    assert result.answer.matches[0].category==category and 0<=result.answer.matches[0].relevance<=1


def answer_payload(answer):
    p=cloud_payload();p['choices'][0]['message']['content']=json.dumps(answer);return json.dumps(p).encode()


def test_foundry_authoring_uses_strict_schema_and_translates_keys():
    provider,opener=cloud(answer_payload({'status':'READY','text':'Generated.','citationKeys':['S1'],'matches':[]}))
    request=command(required=True);result=ModelGateway(provider).generate_authoring(request)
    assert result.answer.citation_ids==['a'*64] and not result.usage.estimated
    body=json.loads(opener.open.call_args.args[0].data)
    assert body['response_format']['json_schema']['name']=='researchhub_authoring_v1'
    assert body['messages'][0]['content']==request.request.system_instruction + '\n\n' + EVIDENCE_POLICY
    assert json.loads(body['messages'][1]['content'])['context']==request.context.text


@pytest.mark.parametrize('answer',[
    {'status':'READY','text':'Invented','citationKeys':['S2'],'matches':[]},
    {'status':'READY','text':'Uncited','citationKeys':[],'matches':[]},
    {'status':'READY','text':'Invented','citationKeys':['S1','S1'],'matches':[]},
    {'status':'INSUFFICIENT_EVIDENCE','text':'Fact','citationKeys':[],'matches':[]},
    {'status':'READY','text':'text','citationKeys':['S1'],'matches':[{'citationKey':'S1','category':'contradictory','relevance':1,'reason':'No'}]},
    {'status':'READY','text':'text','citationKeys':['S1'],'matches':[{'citationKey':'S1','category':'supporting','relevance':0.5,'reason':'No'}]},
])
def test_malformed_or_invented_authoring_output_fails_closed(answer):
    provider,_=cloud(answer_payload(answer))
    with pytest.raises(ProviderError) as error:ModelGateway(provider).generate_authoring(command(required=True))
    assert error.value.code=='AI_OUTPUT_INVALID'


def test_evidence_output_cannot_rewrite_sentence_or_invent_match():
    for answer in [{'status':'READY','text':'rewrite','citationKeys':[],'matches':[]},
                   {'status':'READY','text':'','citationKeys':[],'matches':[{'citationKey':'S2','category':'related','relevance':0.5,'reason':'Context'}]}]:
        provider,_=cloud(answer_payload(answer))
        with pytest.raises(ProviderError):ModelGateway(provider).generate_authoring(command('EVIDENCE'))


def test_authoring_http_requires_auth_bounds_and_returns_safe_failures():
    client=TestClient(create_app(service_token=TOKEN));request=command().model_dump(mode='json',by_alias=True)
    assert client.post('/internal/ai/author',json=request).status_code==401
    response=client.post('/internal/ai/author',headers=AUTH,json=request)
    assert response.status_code==200 and response.headers['cache-control']=='no-store'
    assert response.json()['answer']['citationIds']==['a'*64]
    assert client.post('/internal/ai/author',headers=AUTH,json={}).status_code==400
    assert client.post('/internal/ai/author',headers=AUTH,content='x'*(512*1024+1)).status_code==400
    gateway=Mock();gateway.generate_authoring.side_effect=ProviderError('AI_REFUSED')
    client=TestClient(create_app(service_token=TOKEN,model_gateway=gateway))
    assert client.post('/internal/ai/author',headers=AUTH,json=request).status_code==422
    gateway.generate_authoring.side_effect=ProviderError('AI_UNAVAILABLE',True)
    assert client.post('/internal/ai/author',headers=AUTH,json=request).status_code==503
    gateway.generate_authoring.side_effect=RuntimeError('private prompt')
    response=client.post('/internal/ai/author',headers=AUTH,json=request)
    assert response.status_code==502 and 'private' not in response.text


def test_authoring_retry_is_bounded_and_output_validation_is_shared():
    provider,_=cloud(error=HTTPError('https://example',429,'busy',{},None));sleep=Mock()
    with pytest.raises(ProviderError):ModelGateway(provider,sleep=sleep).generate_authoring(command())
    assert sleep.call_count==2
    gateway=ModelGateway(Mock())
    with pytest.raises(ProviderError):gateway.generate_authoring(command())
    invalid=command().model_copy(update={'request':command().request.model_copy(update={'instruction':'{}'})})
    with pytest.raises(ProviderError):ModelGateway(FakeModelProvider()).generate_authoring(invalid)


def test_shared_authoring_fixtures():
    folder=Path('../contracts/ai/authoring/v1')
    for name in ['draft','rewrite']:
        request=ContextualRequest.model_validate_json((folder/f'{name}-model-request.json').read_text())
        expected=AuthoringResult.model_validate_json((folder/f'{name}-model-result.json').read_text())
        expected.validate_for(request)
        assert ModelGateway(FakeModelProvider()).generate_authoring(request)==expected
