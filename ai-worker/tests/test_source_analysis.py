from __future__ import annotations
from researchhub_worker.ai.safety import EVIDENCE_POLICY
import copy
import hashlib
import json
from pathlib import Path
from unittest.mock import Mock
from urllib.error import HTTPError
import pytest
from fastapi.testclient import TestClient
from researchhub_worker.ai.source_analysis import Answer, AnalysisResult, fake_answer, instruction
from researchhub_worker.ai.context import ContextualRequest
from researchhub_worker.ai.providers import FakeModelProvider, ModelGateway, ProviderError
from researchhub_worker.server import create_app
from test_ai import cloud, cloud_payload, AUTH, TOKEN
from test_ai_context import payload, repack

SOURCES=['00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002']


def command(kind='COMPARISON', texts=None, criteria=None, sources=None):
    sources=sources or SOURCES
    p=payload(); base=json.loads(p['context']['text'].split('\n')[1]); blocks=[]; evidence=[]; bindings=[]
    texts=texts if texts is not None else ['Method: randomized\nMain result: 80%', 'Method: observational\nMain result: 60%']
    for index,text in enumerate(texts):
        block=copy.deepcopy(base); key=f'S{index+1}'; chunk=chr(97+index)*64
        block.update(chunkId=chunk,sourceId=sources[index],text=text,textReference=None)
        blocks.append(block); evidence.append({'chunkId':chunk,'contentHash':hashlib.sha256(text.encode()).hexdigest(),'content':text})
        bindings.append({'citationKey':key,'chunkId':chunk,'textReference':None})
    p['request']['evidence']=evidence;p['context']['summary']['citations']=bindings
    system=(Path('../backend/src/main/resources/ai/templates')/f'source-{kind.lower()}-v1.txt').read_text()
    p['request'].update(templateId=f'source-{kind.lower()}:1',systemInstruction=system,templateHash=hashlib.sha256(system.encode()).hexdigest(),
        instruction=json.dumps({'kind':kind,'selectedSourceIds':sources,'criteria':criteria or ['method','dataset','main result'],
            'instruction':'Compare these sources', 'parentComparisonId':None if kind=='COMPARISON' else '00000000-0000-4000-8000-000000000003'},separators=(',',':')))
    return ContextualRequest.model_validate(repack(p,blocks))


def test_comparison_is_structured_scoped_and_missing_is_not_inferred():
    request=command();result=ModelGateway(FakeModelProvider()).generate_analysis(request)
    assert result.answer.status=='READY' and len(result.answer.rows)==2
    assert result.answer.rows[0].cells[0].text=='randomized'
    assert result.answer.rows[0].cells[0].evidence_ids==['a'*64]
    assert result.answer.rows[1].cells[0].evidence_ids==['b'*64]
    assert result.answer.rows[0].cells[1].text is None
    assert result.answer.rows[0].cells[1].status=='MISSING'
    assert result.answer.summary[0].evidence_ids==['a'*64,'b'*64]
    assert result.usage.estimated and result.template_hash==request.request.template_hash
    result.validate_for(request)


def test_insufficient_empty_and_single_source_evidence_and_custom_criteria():
    gateway=ModelGateway(FakeModelProvider())
    assert gateway.generate_analysis(command(texts=[])).answer.status=='INSUFFICIENT_EVIDENCE'
    assert gateway.generate_analysis(command(texts=['Unlabelled result','Unlabelled result'])).answer.summary==[]
    result=gateway.generate_analysis(command(texts=['Custom: Value','Custom: Other'],criteria=['Custom']))
    assert result.answer.rows[0].cells[0].text=='Value'
    assert gateway.generate_analysis(command('DISAGREEMENTS',texts=['Method: test'])).answer.status=='INSUFFICIENT_EVIDENCE'
    assert gateway.generate_analysis(command('DISAGREEMENTS',texts=['Method: same','Method: same'])).answer.status=='NO_POTENTIAL_DISAGREEMENT'


def test_differences_cite_both_sides_and_include_context_or_flag_its_absence():
    result=ModelGateway(FakeModelProvider()).generate_analysis(command('DISAGREEMENTS'))
    assert result.answer.status=='READY'
    assert result.answer.findings[0].category=='DIFFERENT_EXPERIMENTAL_CONDITIONS'
    assert result.answer.findings[1].category=='DIFFERENT_REPORTED_RESULT'
    assert result.answer.findings[0].sides[0].evidence_ids==['a'*64]
    assert result.answer.findings[0].sides[1].evidence_ids==['b'*64]
    assert result.answer.findings[0].methodological_context.status=='REPORTED'
    result=ModelGateway(FakeModelProvider()).generate_analysis(command('DISAGREEMENTS',texts=['Main result: 80%','Main result: 60%']))
    assert result.answer.findings[0].methodological_context.status=='MISSING'
    assert 'unavailable' in result.answer.findings[0].description


def cloud_result(answer):
    p=cloud_payload();p['choices'][0]['message']['content']=json.dumps(answer);return json.dumps(p).encode()


def local_answer(request):
    return fake_answer(request,instruction(request)).model_dump(mode='json',by_alias=True)


def test_foundry_uses_strict_schema_and_local_evidence_keys():
    request=command();provider,opener=cloud(cloud_result(local_answer(request)))
    result=ModelGateway(provider).generate_analysis(request)
    assert not result.usage.estimated and result.answer.rows[1].cells[0].evidence_ids==['b'*64]
    body=json.loads(opener.open.call_args.args[0].data)
    assert body['response_format']['json_schema']['name']=='researchhub_source_analysis_v1'
    assert body['response_format']['json_schema']['strict']
    assert body['messages'][0]['content']==request.request.system_instruction + '\n\n' + EVIDENCE_POLICY
    assert json.loads(body['messages'][1]['content'])['context']==request.context.text


@pytest.mark.parametrize('mutation', ['invent','cross-source','criteria','source','missing-invented','uncited','status','repeated','summary','findings','blank'])
def test_comparison_validation_fails_closed(mutation):
    request=command();answer=local_answer(request);cell=answer['rows'][0]['cells'][0]
    if mutation=='invent':cell['evidenceIds']=['S99']
    if mutation=='cross-source':cell['evidenceIds']=['S2']
    if mutation=='criteria':cell['criterion']='unrequested'
    if mutation=='source':answer['rows'][0]['sourceId']=SOURCES[1]
    if mutation=='missing-invented':cell['status']='MISSING'
    if mutation=='uncited':cell['evidenceIds']=[]
    if mutation=='status':answer['status']='INSUFFICIENT_EVIDENCE'
    if mutation=='repeated':cell['evidenceIds']=['S1','S1']
    if mutation=='summary':answer['summary'][0]['evidenceIds']=['S99']
    if mutation=='findings':answer['findings']=[local_answer(command('DISAGREEMENTS'))['findings'][0]]
    if mutation=='blank':cell['text']=' '
    provider,_=cloud(cloud_result(answer))
    with pytest.raises(ProviderError) as error:ModelGateway(provider).generate_analysis(request)
    assert error.value.code=='AI_OUTPUT_INVALID'


@pytest.mark.parametrize('mutation',['one-side','same-side','cross-source','context','category','status','rows','summary','unselected'])
def test_disagreement_citations_and_context_are_required(mutation):
    request=command('DISAGREEMENTS');answer=local_answer(request);finding=answer['findings'][0]
    if mutation=='one-side':finding['sides']=finding['sides'][:1]
    if mutation=='same-side':finding['sides'][1]['sourceId']=SOURCES[0]
    if mutation=='cross-source':finding['sides'][0]['evidenceIds']=['S2']
    if mutation=='context':finding['methodologicalContext']['evidenceIds']=['S99']
    if mutation=='category':finding['category']='CONTRADICTION'
    if mutation=='status':answer['status']='NO_POTENTIAL_DISAGREEMENT'
    if mutation=='rows':answer['rows']=local_answer(command())['rows']
    if mutation=='summary':answer['summary']=local_answer(command())['summary']
    if mutation=='unselected':finding['sides'][0]['sourceId']='00000000-0000-4000-8000-000000000099'
    provider,_=cloud(cloud_result(answer))
    with pytest.raises(ProviderError):ModelGateway(provider).generate_analysis(request)


def test_instruction_identity_provider_and_retry_validation():
    request=command()
    for key,value in [('kind','OTHER'),('selectedSourceIds',SOURCES*2),('criteria',['method','METHOD']),('parentComparisonId',SOURCES[0])]:
        fields=json.loads(request.request.instruction);fields[key]=value
        invalid=request.model_copy(update={'request':request.request.model_copy(update={'instruction':json.dumps(fields)})})
        with pytest.raises(ProviderError):ModelGateway(FakeModelProvider()).generate_analysis(invalid)
    result=ModelGateway(FakeModelProvider()).generate_analysis(request)
    with pytest.raises(ValueError):result.model_copy(update={'template_id':'wrong'}).validate_for(request)
    with pytest.raises(ProviderError):ModelGateway(Mock()).generate_analysis(request)
    provider,_=cloud(error=HTTPError('https://example',429,'busy',{},None));sleep=Mock()
    with pytest.raises(ProviderError):ModelGateway(provider,sleep=sleep).generate_analysis(request)
    assert sleep.call_count==2


def test_authenticated_http_bounded_requests_and_safe_errors():
    request=command().model_dump(mode='json',by_alias=True);client=TestClient(create_app(service_token=TOKEN))
    assert client.post('/internal/ai/analyze',json=request).status_code==401
    response=client.post('/internal/ai/analyze',headers=AUTH,json=request)
    assert response.status_code==200 and response.headers['cache-control']=='no-store'
    assert client.post('/internal/ai/analyze',headers=AUTH,json={}).status_code==400
    assert client.post('/internal/ai/analyze',headers=AUTH,content='x'*(512*1024+1)).status_code==400
    gateway=Mock();client=TestClient(create_app(service_token=TOKEN,model_gateway=gateway))
    for failure,status in [(ProviderError('AI_REFUSED'),422),(ProviderError('AI_UNAVAILABLE',True),503),(RuntimeError('private prompt'),502)]:
        gateway.generate_analysis.side_effect=failure
        response=client.post('/internal/ai/analyze',headers=AUTH,json=request)
        assert response.status_code==status and 'private' not in response.text


def test_shared_java_python_fixtures():
    folder=Path('../contracts/ai/source-analysis/v1')
    for kind in ['comparison','disagreements']:
        request=ContextualRequest.model_validate_json((folder/f'{kind}-model-request.json').read_text())
        result=AnalysisResult.model_validate_json((folder/f'{kind}-model-result.json').read_text())
        result.validate_for(request)
        assert result==ModelGateway(FakeModelProvider()).generate_analysis(request)


def test_five_sources_custom_fields_and_findings_are_bounded():
    criteria=['method','dataset','metric','main result','limitations']
    sources=[f'00000000-0000-4000-8000-{index:012d}' for index in range(1,6)]
    texts=['\n'.join(f'{field}: value {index}' for field in criteria) for index in range(5)]
    gateway=ModelGateway(FakeModelProvider())
    result=gateway.generate_analysis(command(texts=texts,criteria=criteria,sources=sources))
    assert len(result.answer.rows)==5 and all(len(row.cells)==5 for row in result.answer.rows)
    result=gateway.generate_analysis(command('DISAGREEMENTS',texts=texts,criteria=criteria,sources=sources))
    assert len(result.answer.findings)==5
