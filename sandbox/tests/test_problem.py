"""Controlled runtime tests use fixed AST, never execute generated source on the host."""
import copy
import hashlib
import json
from pathlib import Path
import pytest
import problem
from protocol import ProtocolError
ROOT=Path(__file__).resolve().parents[2]
BASE=json.loads((ROOT/'contracts/analysis/computation-plan/v2/problem-snapshot.json').read_text())
PLAN=json.loads((ROOT/'contracts/analysis/computation-plan/v2/problem-plan.json').read_text())
N=lambda v:{'op':'number','value':str(v)}
S=lambda v:{'op':'symbol','name':v}

def simple(ast,kind='EVALUATE',unit='1',parameters=None,unknowns=None):
    s=copy.deepcopy(BASE);s['problem'].update(parameters=parameters or [],unknowns=unknowns or [],plot=None)
    o={'name':'result','kind':kind,'expression':ast,'unit':unit};s['problem']['expectedOutputs']=[o]
    p=copy.deepcopy(PLAN);p['outputs']=[o]
    return s,p

def value(ast):
    s,p=simple(ast);return problem.compute(s,p)['outputs'][0]['values'][0]

@pytest.mark.parametrize('ast,expected',[(N('-1.25'),-1.25),({'op':'add','args':[N(2),N(3)]},5),({'op':'mul','args':[N(2),N(3)]},6),({'op':'div','left':N(1),'right':N(4)},.25),({'op':'pow','base':N(2),'exponent':-2},.25),({'op':'sqrt','arg':N(9)},3),({'op':'sin','arg':N(0)},0),({'op':'cos','arg':N(0)},1)])
def test_evaluate(ast,expected):assert value(ast)==pytest.approx(expected)

def test_units_plot_and_roots():
    result=problem.compute(BASE,PLAN);assert result['outputs'][0]['values']==[.5];assert len(result['plot']['points'])==11;assert result['plot']['points'][-1]==[100,.5]
    s,p=simple({'op':'sin','arg':S('angle')},parameters=[{'symbol':'angle','value':'90','unit':'deg'}]);assert problem.compute(s,p)['outputs'][0]['values']==[1]
    for unit in problem.UNITS:
        assert problem.factor(unit)>0
    for degree in range(1,5):
        s,p=simple({'op':'eq','left':{'op':'pow','base':S('x'),'exponent':degree},'right':N(16)},kind='SOLVE',unknowns=[{'symbol':'x','unit':'1'}]);r=problem.compute(s,p);assert r['outputs'][0]['values']

@pytest.mark.parametrize('ast',json.loads((ROOT/'contracts/document/math/v1/ast-fixtures.json').read_text())['invalid'])
def test_shared_hostile_ast(ast):
    with pytest.raises((ProtocolError,TypeError,KeyError)):problem.ast(ast,{})

@pytest.mark.parametrize('ast',[S('missing'),{'op':'div','left':N(1),'right':N(0)},{'op':'pow','base':N(0),'exponent':0},{'op':'sqrt','arg':N(-1)},{'op':'sqrt','arg':S('distance')},{'op':'sin','arg':S('distance')},{'op':'add','args':[S('distance'),N(2)]},{'op':'eq','left':S('distance'),'right':N(2)}])
def test_invalid_computation(ast):
    s,p=simple(ast,parameters=[{'symbol':'distance','value':'1','unit':'m'}]);
    with pytest.raises((ProtocolError,TypeError,ValueError)):problem.compute(s,p)

@pytest.mark.parametrize('edit',[lambda s,p:s.update(schemaVersion='1.0'),lambda s,p:s.update(templateId='evil'),lambda s,p:p.update(workload='DATASET'),lambda s,p:p.update(problemHash='e'*64),lambda s,p:p.update(clarifications=['missing']),lambda s,p:s['problem'].update(domain=None),lambda s,p:s['problem']['parameters'].append(s['problem']['parameters'][0]),lambda s,p:s['problem']['parameters'][0].update(symbol='__import__'),lambda s,p:s['problem']['parameters'][0].update(unit='secret'),lambda s,p:s['problem']['expectedOutputs'][0].update(kind='EVAL'),lambda s,p:s['problem']['plot'].update(parameter='evil'),lambda s,p:s['problem']['plot'].update(points=202),lambda s,p:s['problem']['plot'].update(start='101'),lambda s,p:s['problem']['plot'].update(output='missing')])
def test_invalid_frozen_manifest(edit):
    s,p=copy.deepcopy(BASE),copy.deepcopy(PLAN);edit(s,p)
    with pytest.raises((ProtocolError,ValueError,KeyError)):problem.compute(s,p)

@pytest.mark.parametrize('ast',[{'op':'eq','left':{'op':'pow','base':S('x'),'exponent':8},'right':N(1)},{'op':'eq','left':{'op':'sin','arg':S('x')},'right':N(1)},{'op':'eq','left':{'op':'pow','base':S('x'),'exponent':2},'right':N(-1)}])
def test_bounded_cas(ast):
    s,p=simple(ast,kind='SOLVE',unknowns=[{'symbol':'x','unit':'1'}])
    with pytest.raises((ProtocolError,ValueError)):problem.compute(s,p)

@pytest.mark.parametrize('actual,expected',[(1,1),(1.00000000001,1),(None,None),('safe','safe'),([1,2],[1,2]),({'a':1},{'a':1})])
def test_comparison(actual,expected):problem.compare(actual,expected)
@pytest.mark.parametrize('actual,expected',[(2,1),(True,1),(float('nan'),1),('evil','safe'),([1],[1,2]),({'a':1,'verified':True},{'a':1}),({'a':2},{'a':1})])
def test_forged_verified_values(actual,expected):
    with pytest.raises(ProtocolError):problem.compare(actual,expected)


def stage(tmp_path,verify=False,candidate=None):
    execution=tmp_path/'execution';inputs=tmp_path/'inputs';outputs=tmp_path/'outputs'
    for p in [execution,inputs,outputs]:p.mkdir()
    entries=[]
    for name,v in {'problem.json':BASE,'plan.json':PLAN,**({'candidate.json':candidate or problem.compute(BASE,PLAN)} if verify else {})}.items():
        b=json.dumps(v,separators=(',',':'),sort_keys=True).encode();(inputs/name).write_bytes(b);entries.append({'name':name,'file':'/inputs/'+name,'sha256':hashlib.sha256(b).hexdigest()})
    manifest={'schemaVersion':'2.0','workload':'PROBLEM','phase':'VERIFY' if verify else 'COMPUTE','files':entries,'outputs':[{'name':'verification','kind':'TEXT'}] if verify else [{'name':'calculation','kind':'TEXT'},{'name':'plot-data','kind':'TABLE'},{'name':'plot','kind':'CHART'}]}
    (execution/'manifest.json').write_text(json.dumps(manifest));return execution,inputs,outputs

@pytest.mark.parametrize('verify',[False,True])
def test_controlled_entrypoints(tmp_path,verify):
    paths=stage(tmp_path,verify);problem.execute(verify,*paths);result=json.loads((paths[2]/'result.json').read_text());text=json.loads(result['outputs'][0]['text']);assert text.get('status')=='CHECKED' if verify else text['outputs'][0]['values']==[.5]
    if not verify:assert (paths[2]/'plot.png').read_bytes().startswith(b'\x89PNG')

@pytest.mark.parametrize('edit',[lambda m:m.update(phase='OTHER'),lambda m:m.update(schemaVersion='1.0'),lambda m:m['files'][0].update(file='/etc/passwd'),lambda m:m['files'][0].update(sha256='f'*64),lambda m:m['files'].append(m['files'][0]),lambda m:m['files'].pop()])
def test_input_hash_paths_phase_and_duplicates(tmp_path,edit):
    paths=stage(tmp_path);m=json.loads((paths[0]/'manifest.json').read_text());edit(m);(paths[0]/'manifest.json').write_text(json.dumps(m))
    with pytest.raises((ProtocolError,KeyError)):problem.execute(False,*paths)


def test_verifier_rejects_tampered_candidate_and_main_sanitizes(tmp_path,monkeypatch,capsys):
    candidate=problem.compute(BASE,PLAN);candidate['outputs'][0]['values']=[9000];paths=stage(tmp_path,True,candidate)
    with pytest.raises(ProtocolError):problem.execute(True,*paths)
    monkeypatch.setattr(problem,'execute',lambda *a:(_ for _ in ()).throw(RuntimeError('secret')));monkeypatch.setattr(problem.sys,'argv',['problem.py']);assert problem.main()==65;assert 'secret' not in capsys.readouterr().err
    monkeypatch.setattr(problem,'execute',lambda *a:None);assert problem.main()==0
    monkeypatch.setattr(problem.sys,'argv',['problem.py','injected']);assert problem.main()==65


def test_fresh_verifier_script_is_controlled(monkeypatch):
    import runpy
    monkeypatch.setattr(problem,'main',lambda verify=False: 0 if verify else 1)
    with pytest.raises(SystemExit) as error: runpy.run_path(str(ROOT/'sandbox/runtime/verify_problem.py'),run_name='__main__')
    assert error.value.code==0


def test_numeric_explosion_budget_is_independent_of_prompt_length():
    ast=N(2)
    for _ in range(5):ast={'op':'pow','base':ast,'exponent':8}
    s,p=simple(ast)
    with pytest.raises(ProtocolError):problem.compute(s,p)
    with pytest.raises(ProtocolError):problem.complexity({'op':'import'})
