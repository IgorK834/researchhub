import copy
import json
from pathlib import Path
from uuid import uuid4
import pytest
from researchhub_worker.analysis.problem import Problem, Plan, PlanningRequest, generate_candidate,validate_ast
from researchhub_worker.ai.contracts import GenerationRequest
from researchhub_worker.ai.providers import FakeModelProvider, ModelGateway,ProviderError
ROOT=Path(__file__).resolve().parents[2]
PROBLEM=json.loads((ROOT/'contracts/analysis/computation-plan/v2/problem-create.json').read_text())['problem']
PLAN=json.loads((ROOT/'contracts/analysis/computation-plan/v2/problem-plan.json').read_text())

def request():
    import hashlib
    instruction='Plan only. Do not compute.'
    return PlanningRequest(schema_version='2.0',analysis_id=uuid4(),problem=PROBLEM,problem_hash='a'*64,request=GenerationRequest(schema_version='1.0',request_id=uuid4(),template_id='problem-plan:2',template_hash=hashlib.sha256(instruction.encode()).hexdigest(),system_instruction=instruction,instruction='Calculate speed',parameters={'temperature':0,'maxOutputTokens':4096},evidence=[]))

def test_shared_problem_and_dataset_contracts():
    problem=Problem.model_validate(PROBLEM);assert problem.domain=='REAL';plan=Plan.model_validate(PLAN);plan.validate_for(request())
    result=ModelGateway(FakeModelProvider()).plan_problem(request());saved=Plan.model_validate_json(result.output);assert saved.outputs==problem.expected_outputs;assert 'values' not in result.output;assert result.model.provider=='deterministic'

@pytest.mark.parametrize('value',json.loads((ROOT/'contracts/document/math/v1/ast-fixtures.json').read_text())['valid'])
def test_valid_shared_ast(value):assert validate_ast(value)==value
@pytest.mark.parametrize('value',json.loads((ROOT/'contracts/document/math/v1/ast-fixtures.json').read_text())['invalid'])
def test_invalid_shared_ast(value):
    with pytest.raises(ValueError):validate_ast(value)

@pytest.mark.parametrize('edit',[lambda p:p['parameters'][0].update(value='1,2'),lambda p:p['parameters'][0].update(value='NaN'),lambda p:p['parameters'][0].update(unit='evil'),lambda p:p['unknowns'].append({'symbol':'x','unit':'evil'}),lambda p:p['parameters'].append(p['parameters'][0]),lambda p:p['unknowns'].append({'symbol':'distance','unit':'m'}),lambda p:p['expectedOutputs'].append(p['expectedOutputs'][0]),lambda p:p['expectedOutputs'][0].update(unit='secret'),lambda p:p['plot'].update(start='100',end='0'),lambda p:p['assumptions'].append(' '*5),lambda p:p.update(statement=' ')])
def test_invalid_inputs(edit):
    p=copy.deepcopy(PROBLEM);edit(p)
    with pytest.raises(ValueError):Problem.model_validate(p)

def test_missing_values_preserved_and_frozen_identity_cannot_change():
    p=copy.deepcopy(PROBLEM);p['parameters'][0].update(value=None,unit=None);p['domain']=None;p['expectedOutputs'][0]['expression']=None;Problem.model_validate(p)
    req=request();assert json.loads(req.user_message())['problem']==PROBLEM
    with pytest.raises(ValueError):PlanningRequest.model_validate({**req.model_dump(by_alias=True),'request':{**req.request.model_dump(by_alias=True),'templateId':'evil'}})
    with pytest.raises(ValueError):Plan.model_validate({**PLAN,'problemHash':'b'*64}).validate_for(req)
    with pytest.raises(ValueError):Plan.model_validate({**PLAN,'warnings':[' '*5]})

def test_native_provider_and_invalid_candidate_failures():
    class Native(FakeModelProvider):
        def complete(self,*a):return {'choices':[{'message':{'content':json.dumps(PLAN)}}],'usage':{'prompt_tokens':1,'completion_tokens':1,'total_tokens':2},'id':'native'}
    # use delegation to exercise the real adapter path, not the offline provider branch
    class Adapter:
        def model_metadata(self):return FakeModelProvider().model_metadata()
        def complete(self,*a):return Native().complete(*a)
    result=generate_candidate(Adapter(),request());assert result.provider_request_id=='native'
    for failure in [ProviderError('AI_UNAVAILABLE'),ValueError('bad'),RuntimeError('bad')]:
        class Broken(Adapter):
            def complete(self,*a):raise failure
        with pytest.raises(ProviderError):generate_candidate(Broken(),request())


def test_native_schema_is_closed_and_auth_endpoint_uses_same_contract():
    from fastapi.testclient import TestClient
    from researchhub_worker.server import create_app
    schema=Plan.model_json_schema(by_alias=True)
    assert schema['$defs']['Output']['properties']['expression']['anyOf'][0]=={'$ref':'#/$defs/MathAst'}
    assert schema['$defs']['MathAst']['oneOf'][0]['additionalProperties'] is False
    token='problem-test-token-at-least-32-characters'
    client=TestClient(create_app(service_token=token,model_gateway=ModelGateway(FakeModelProvider())))
    path='/internal/analysis/problem/plan';payload=request().model_dump(mode='json',by_alias=True)
    assert client.post(path,json=payload).status_code==401
    assert client.post(path,headers={'Authorization':'Bearer '+token},json={}).status_code==400
    result=client.post(path,headers={'Authorization':'Bearer '+token},json=payload)
    assert result.status_code==200
    assert Plan.model_validate_json(result.json()['output']).workload=='PROBLEM'


def test_shared_versions_and_generated_closed_schemas():
    from researchhub_worker.analysis.contracts import Plan as DatasetPlan,PlanningRequest as DatasetRequest
    for name,model in [('problem',Problem),('plan',Plan),('request',PlanningRequest)]:
        saved=json.loads((ROOT/('contracts/analysis/computation-plan/v2/'+name+'.schema.json')).read_text());saved.pop('$schema')
        assert saved==model.model_json_schema(by_alias=True)
    v1=DatasetRequest.model_validate_json((ROOT/'contracts/analysis/computation-plan/v1/request.json').read_text())
    old=DatasetPlan.model_validate_json((ROOT/'contracts/analysis/computation-plan/v1/plan.json').read_text());assert old.schema_version=='1.0';assert v1.inputs
    new=Plan.model_validate(PLAN);assert new.schema_version=='2.0';assert new.workload=='PROBLEM'
    for schema,payload in [(DatasetPlan,PLAN),(Plan,old.model_dump(mode='json',by_alias=True))]:
        with pytest.raises(ValueError):schema.model_validate(payload)


def test_shared_saved_solution_preserves_native_ast_and_explicit_unchecked_interpretation():
    # Saved bundles are assembled by the Java host, never generated or granted CHECKED by this worker.
    bundle=json.loads((ROOT/'contracts/analysis/execution/v3/solution.json').read_text())
    assert bundle['kind']=='SOLUTION' and bundle['interpretation']['status']=='NOT_CHECKED'
    for step in bundle['steps']:
        validate_ast(step['expression'])
        assert step['expression']==PLAN['outputs'][0]['expression']
        assert step['substitution']['distance']=={'value':'100','unit':'cm','siValue':'1'}
        with pytest.raises(ValueError):validate_ast({**step['expression'],'script':'import os'})
    block=json.loads((ROOT/'contracts/analysis/document-block/v2/block.json').read_text())
    assert block['attrs']['reference']['executionId']==bundle['executionId']
    assert block['attrs']['reference']['stepId']==bundle['steps'][0]['id']
    provenance=json.loads((ROOT/'contracts/analysis/provenance/v2/problem.json').read_text())
    assert provenance['workload']=='PROBLEM' and 'sourceVersionId' not in provenance
