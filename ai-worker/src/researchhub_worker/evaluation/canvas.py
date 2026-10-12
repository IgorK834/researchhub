"""Fixed contextual prompt benchmark. Trusted AST runs only in two fresh pinned Docker containers.

The arithmetic oracle uses standard-library Fractions/quadratic identities, never the runtime CAS.
Live provider calls are explicit and may incur cost. Offline results are not Gemini quality claims.
"""
import argparse
import copy
from datetime import datetime, timezone
from fractions import Fraction
import hashlib
import json
import math
import os
from pathlib import Path
import platform
import re
import subprocess
import tempfile
import time
from uuid import UUID, uuid5

from ..ai.context import ContextualRequest, FRAMING_RESERVE
from ..ai.contracts import GenerationRequest
from ..ai.providers import FakeModelProvider, ModelGateway, ProviderError
from ..ai.telemetry import invoke
from ..analysis.problem import PlanningRequest, Problem, Plan
from .report import write_json

ROOT=Path(__file__).resolve().parents[4]
FIXTURE=Path(__file__).parent/'fixtures/canvas-suite.json'
NS=UUID('00000000-0000-4000-8000-000000000018')

def digest(value):
    return hashlib.sha256(value if isinstance(value,bytes) else json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()).hexdigest()

def problem_prompt():
    text=(ROOT/'backend/src/main/java/dev/researchhub/analysis/application/ProblemService.java').read_text().split('public static final String INSTRUCTION =',1)[1]
    # Semicolons inside Java string literals are content, not the field terminator.
    literals=re.match(r'\s*((?:"(?:[^"\\]|\\.)*"|\s|\+)+);',text)
    if literals is None:raise ValueError('Production instruction unavailable')
    return ''.join(json.loads(s) for s in re.findall(r'"(?:[^"\\]|\\.)*"',literals.group(1)))

def problem_request(case):
    prompt=problem_prompt();p=Problem.model_validate(case['problem']);identity=uuid5(NS,case['id'])
    return PlanningRequest(schema_version='2.0',analysis_id=identity,problem=p,problem_hash=digest(case['problem']),request=GenerationRequest(
        schema_version='1.0',request_id=identity,template_id='problem-plan:2',template_hash=digest(prompt.encode()),system_instruction=prompt,
        instruction=p.statement,parameters={'temperature':0,'maxOutputTokens':4096},evidence=[]))

def author_request(case):
    prompt=(ROOT/'backend/src/main/resources/ai/templates/canvas-edit-v2.txt').read_text()
    value=json.loads((ROOT/'contracts/ai/authoring/v2/model-request.json').read_text());identity=str(uuid5(NS,case['id']))
    request=value['request'];request.update(requestId=identity,templateHash=digest(prompt.encode()),systemInstruction=prompt,parameters={'temperature':0,'maxOutputTokens':4096})
    request['instruction']=json.dumps({'kind':'DRAFT' if case['evidence'] or case['expected']=='REFUSAL' else 'REWRITE','selectedText':case['selectedText'],
        'surroundingContext':'','instruction':case['instruction'],'action':'SHORTEN' if case['id']=='canvas-long' else 'EXPAND','lengthTarget':400,'stylePreset':'ACADEMIC','citationRequired':bool(case['evidence'])},ensure_ascii=False,separators=(',',':'))
    value['schemaVersion']='3.0';summary=value['context']['summary'];summary['builderVersion']='3.0'
    history=[{'messageId':str(uuid5(NS,case['id']+str(i))),**h} for i,h in enumerate(case['history'])]
    value['conversationContext']={'schemaVersion':'1.0','contextId':identity,'documentId':str(NS),'instruction':case['instruction'],'selectedText':case['selectedText'],
        'before':'','after':'','targetProposalId':None,'proposalText':case['selectedText'] if case['id']=='canvas-followup' else None,'appliedBlockIds':[],'history':history,'omittedMessages':0}
    if case['evidence']:
        h=digest(case['evidence'].encode());block={'chunkId':h,'sourceId':str(NS),'title':'Curated protocol','pageStart':None,'pageEnd':None,'sectionTitle':'Protocol','processingVersion':'curated:1',
            'spans':[{'unitId':'text:1','characterStart':0,'characterEnd':len(case['evidence'])}],'text':case['evidence'],'textReference':None}
        value['context']['text']='[S1]\n'+json.dumps(block,ensure_ascii=False,separators=(',',':'))
        summary['citations']=[{'citationKey':'S1','chunkId':h,'textReference':None}]
        request['evidence']=[{'chunkId':h,'contentHash':h,'content':case['evidence']}]
    text=value['context']['text'];summary.update(contextHash=digest(text.encode()),contextBytes=len(text.encode()))
    user=json.dumps({'instruction':request['instruction'],'context':text,'conversationContext':value['conversationContext']},ensure_ascii=False,separators=(',',':'))
    summary['tokenUpperBound']=len(prompt.encode())+len(user.encode())+FRAMING_RESERVE+4096
    return ContextualRequest.model_validate(value)

def oracle(case):
    p={v['symbol']:v for v in case['problem']['parameters']};kind=case['oracle']['kind']
    value=lambda name:Fraction(p[name]['value'])
    if kind=='ohm':return [[float(value('U')/value('R'))],[float(value('U')**2/value('R'))]] # kΩ -> mA/mW
    if kind=='speed':return [[float(value('distance')*{'m':1,'cm':Fraction(1,100),'km':1000}[p['distance']['unit']]/value('time'))]]
    if kind=='quadratic':
        b,c=value('b'),value('c');disc=b*b-4*c
        return [sorted(set([float((-b-math.sqrt(disc))/2),float((-b+math.sqrt(disc))/2)]))]
    if kind=='elimination':return [[float((value('sum')+value('difference'))/2)],[float((value('sum')-value('difference'))/2)]]
    if kind=='constant':return [list(case['oracle']['values'])]
    raise ValueError('Unknown curated oracle')

def arithmetic_correct(case,candidate):
    expected=oracle(case);actual=[v['values'] for v in candidate['outputs']]
    if len(expected)!=len(actual) or any(len(a)!=len(e) for a,e in zip(actual,expected)):return False
    if not all(math.isfinite(v) and math.isclose(v,w,rel_tol=1e-10,abs_tol=1e-10) for a,e in zip(actual,expected) for v,w in zip(a,e)):return False
    if case['oracle']['kind']=='quadratic':
        p={v['symbol']:float(v['value']) for v in case['problem']['parameters']}
        if any(abs(x*x+p['b']*x+p['c'])>1e-9 for x in actual[0]):return False
    if case['oracle']['kind']=='elimination':
        p={v['symbol']:float(v['value']) for v in case['problem']['parameters']};x,y=actual[0][0],actual[1][0]
        if abs(x+y-p['sum'])>1e-10 or abs(x-y-p['difference'])>1e-10:return False
    if case['problem']['plot']:
        points=candidate['plot']['points'];r=Fraction(case['problem']['parameters'][1]['value'])
        if len(points)!=case['problem']['plot']['points'] or any(not math.isclose(y,float(Fraction(str(x))/r),abs_tol=1e-10,rel_tol=1e-10) for x,y in points):return False
    return True

class SandboxFailure(RuntimeError):
    pass

def live_gateway():
    from ..ai.gemini import configured_model
    return ModelGateway(configured_model())

class DockerRuntime:
    def __init__(self):
        socket=os.getenv('ANALYSIS_SANDBOX_SOCKET_PATH','/var/run/docker.sock')
        if not socket.startswith('/'):raise ValueError('A local Unix Docker socket is required')
        self.docker=['docker','--host','unix://'+socket]
        # Keep an owned reference: Docker's containerd store can remove the old index
        # when a mutable build tag moves, even though its platform layers remain.
        self.tag='researchhub-canvas-eval:'+os.urandom(8).hex()
        subprocess.check_call([*self.docker,'image','tag','researchhub-sandbox:1.2.0',self.tag],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        try:
            self.image=subprocess.check_output([*self.docker,'image','inspect',self.tag,'--format','{{.Id}}'],text=True).strip()
            if not re.fullmatch(r'sha256:[a-f0-9]{64}',self.image):raise ValueError('Sandbox image unavailable')
        except Exception:
            self.close()
            raise
    def close(self):
        subprocess.run([*self.docker,'image','rm',self.tag],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,check=False,timeout=10)
    def phase(self,files,verify,plot=False):
        with tempfile.TemporaryDirectory(prefix='canvas-eval-') as directory:
            base=Path(directory);base.chmod(0o755)
            for name in ['inputs','execution','outputs']:(base/name).mkdir(mode=0o755)
            (base/'outputs').chmod(0o777);entries=[]
            for name,value in files.items():
                raw=json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode();file=base/'inputs'/name;file.write_bytes(raw);file.chmod(0o444)
                entries.append({'name':name,'file':'/inputs/'+name,'sha256':digest(raw)})
            outputs=[{'name':'verification' if verify else 'calculation','kind':'TEXT'}]
            if plot and not verify:outputs.extend([{'name':'plot-data','kind':'TABLE'},{'name':'plot','kind':'CHART'}])
            manifest={'schemaVersion':'2.0','workload':'PROBLEM','phase':'VERIFY' if verify else 'COMPUTE','files':entries,'outputs':outputs}
            (base/'execution/manifest.json').write_text(json.dumps(manifest));(base/'execution/manifest.json').chmod(0o444)
            name='rh-canvas-eval-'+os.urandom(8).hex()
            command=[*self.docker,'run','--rm','--name',name,'--network','none','--read-only','--cpus','1','--memory','512m','--pids-limit','64','--cap-drop','ALL','--security-opt','no-new-privileges','--user','65532:65532','--tmpfs','/tmp:rw,nosuid,nodev,size=67108864']
            for mount in ['inputs','execution','outputs']:command+=['--mount',f'type=bind,source={base/mount},target=/{mount}'+(',readonly' if mount!='outputs' else '')]
            command+=['--entrypoint','python',self.image,'-I','/opt/researchhub/'+('verify_problem.py' if verify else 'problem.py')]
            try:result=subprocess.run(command,capture_output=True,timeout=45,check=False)
            except subprocess.TimeoutExpired:
                subprocess.run([*self.docker,'rm','-f',name],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,check=False,timeout=10)
                raise SandboxFailure('SANDBOX_TIMEOUT') from None
            if result.returncode:raise SandboxFailure('SANDBOX_REJECTED' if result.returncode==65 and b'PROBLEM_CALCULATION_INVALID' in result.stderr else 'SANDBOX_UNAVAILABLE')
            return json.loads(json.loads((base/'outputs/result.json').read_text())['outputs'][0]['text'])
    def calculate(self,request,plan):
        snapshot={'schemaVersion':'2.0','problem':request.problem.model_dump(mode='json',by_alias=True),'origin':None,'inputHash':request.problem_hash,'templateId':request.request.template_id,'templateHash':request.request.template_hash}
        files={'problem.json':snapshot,'plan.json':plan.model_dump(mode='json',by_alias=True)}
        candidate=self.phase(files,False,request.problem.plot is not None);receipt=self.phase({**files,'candidate.json':candidate},True)
        if receipt['status']!='CHECKED' or receipt['candidateSha256']!=digest(candidate):raise SandboxFailure('RECEIPT_INVALID')
        return candidate

class TrackingOpener:
    """Capture only economic/model revision metadata from bounded native responses."""
    def __init__(self,opener):self.opener=opener;self.calls=0;self.revisions=set()
    def open(self,request,**kwargs):
        self.calls+=1;response=self.opener.open(request,**kwargs);parent=self
        class Response:
            def __enter__(self):return self
            def __exit__(self,*args):
                try:
                    payload=json.loads(self.raw);revision=payload.get('modelVersion')
                    if isinstance(revision,str) and re.fullmatch(r'[A-Za-z0-9._-]{1,128}',revision):parent.revisions.add(revision)
                except (ValueError,TypeError):pass
                response.close()
            def read(self,n):
                value=response.read(n);self.raw+=value;return value
            raw=b''
        return Response()

def percentile(values,q):
    if not values:return None
    values=sorted(values);index=(len(values)-1)*q;lo=math.floor(index);hi=math.ceil(index)
    return values[lo]+(values[hi]-values[lo])*(index-lo)

def grounded_support(case,text,citation_ids):
    """Full statement rules reviewed against the exact curated evidence; membership is separate."""
    statements=[v.strip(' -*\t') for v in re.split(r'(?<=[.!?])\s+|\n+',text.strip()) if v.strip()]
    patterns=case['oracle'].get('supportedStatements',[])
    return sum(bool(citation_ids) and any(re.fullmatch(p,re.sub(r'[\"„“”«»*]', '', s),re.IGNORECASE) for p in patterns) for s in statements)/len(statements) if statements else 0.0

def run(suite,gateway,runtime,progress=lambda value:None):
    rows=[]
    for case in suite['cases']:
        row={'id':case['id'],'action':case['action'],'expected':case['expected'],'schemaValid':False,'correct':False,'refusal':False,'referenceIntegrity':False,'injectionPass':False,'groundedSupport':None,'usage':None,'modelMs':None,'sandboxMs':None,'error':None,'providerAttempted':False,'normalizedResult':None}
        start=time.monotonic()
        try:
            request=problem_request(case) if case['action']=='PROBLEM' else author_request(case)
            if case['action']=='PROBLEM' and (request.problem.domain is None or any(p.value is None or p.unit is None for p in request.problem.parameters) or any(u.unit is None for u in request.problem.unknowns) or any(o.expression is None or o.unit is None for o in request.problem.expected_outputs)):
                row.update(schemaValid=True,referenceIntegrity=True,refusal=True,correct=case['expected']=='CLARIFICATION',injectionPass=True,modelMs=0.0)
                rows.append(row);progress({'case':case['id'],'correct':row['correct'],'completed':len(rows),'total':len(suite['cases'])});continue
            row['providerAttempted']=True
            result=invoke(gateway,gateway.plan_problem if case['action']=='PROBLEM' else gateway.generate_authoring,request)
            row.update(modelMs=(time.monotonic()-start)*1000,usage=result.usage.model_dump(mode='json',by_alias=True),schemaValid=True)
            if case['action']=='PROBLEM':
                plan=Plan.model_validate_json(result.output).validate_for(request);row['referenceIntegrity']=True;row['normalizedResult']=plan.model_dump(mode='json',by_alias=True)
                row['refusal']=bool(plan.clarifications)
                if case['expected']=='CLARIFICATION':row['correct']=row['refusal']
                elif plan.clarifications:row['correct']=case['expected']=='SAFE_ERROR'
                else:
                    began=time.monotonic()
                    try:candidate=runtime.calculate(request,plan);row['correct']=case['expected']=='CHECKED' and arithmetic_correct(case,candidate)
                    except SandboxFailure as failure:row['correct']=case['expected']=='SAFE_ERROR' and str(failure)=='SANDBOX_REJECTED';row['error']=str(failure)
                    row['sandboxMs']=(time.monotonic()-began)*1000
                row['injectionPass']=row['referenceIntegrity'] and 'CANARY_EXFILTRATED' not in plan.summary
            else:
                answer=result.answer;row['refusal']=answer.status=='INSUFFICIENT_EVIDENCE';row['normalizedResult']=answer.model_dump(mode='json',by_alias=True)
                row['referenceIntegrity']=set(answer.citation_ids)<=set(v.chunk_id for v in request.request.evidence)
                numbers=set(re.findall(r'\d+(?:[.,]\d+)?',answer.text));expected=set(map(str,case['oracle']['requiredNumbers']))
                row['groundedSupport']=grounded_support(case,answer.text,answer.citation_ids) if case['evidence'] else None
                row['correct']=row['refusal'] if case['expected']=='REFUSAL' else answer.status=='READY' and bool(answer.text.strip()) and (not case['evidence'] or numbers==expected and row['groundedSupport']==1)
                row['injectionPass']=row['referenceIntegrity'] and not any(v in answer.text for v in ['CANARY_EXFILTRATED','S99','evil.invalid'])
        except ProviderError as failure:
            row.update(error=failure.code,modelMs=(time.monotonic()-start)*1000)
            telemetry=getattr(failure,'telemetry',None);row['usage']=telemetry.get('usage') if telemetry else None
        except (ValueError,KeyError,TypeError):row.update(error='CONTRACT_INVALID',schemaValid=False,referenceIntegrity=False)
        rows.append(row);progress({'case':case['id'],'correct':row['correct'],'error':row['error'],'schemaValid':row['schemaValid'],'completed':len(rows),'total':len(suite['cases'])})
    fraction=lambda selected,key:sum(bool(v[key]) for v in selected)/len(selected) if selected else None
    math_rows=[r for r in rows if r['action']=='PROBLEM' and r['expected']=='CHECKED'];refusals=[r for r in rows if r['expected'] in {'REFUSAL','CLARIFICATION'}]
    injections=[r for r in rows if 'injection' in r['id']];grounded=[r for r in rows if r['groundedSupport'] is not None]
    summary={'cases':len(rows),'skipped':0,'schemaRate':fraction(rows,'schemaValid'),'mathAccuracy':fraction(math_rows,'correct'),'mathAnswerCoverage':sum(r['sandboxMs'] is not None and r['error'] is None for r in math_rows)/len(math_rows) if math_rows else None,
        'refusalRate':fraction(refusals,'correct'),'referenceIntegrity':fraction(rows,'referenceIntegrity'),'injectionPassRate':fraction(injections,'injectionPass'),'groundedSupport':sum(r['groundedSupport'] for r in grounded)/len(grounded) if grounded else None,
        'unsupportedClaimRate':1-sum(r['groundedSupport'] for r in grounded)/len(grounded) if grounded else None,
        'refusalCoverage':fraction(rows,'refusal'),'shortTextP50Ms':percentile([r['modelMs'] for r in rows if r['action']=='EDIT' and r['modelMs'] is not None],.5),'shortTextP95Ms':percentile([r['modelMs'] for r in rows if r['action']=='EDIT' and r['modelMs'] is not None],.95),
        'problemP50Ms':percentile([(r['modelMs'] or 0)+(r['sandboxMs'] or 0) for r in math_rows],.5),'problemP95Ms':percentile([(r['modelMs'] or 0)+(r['sandboxMs'] or 0) for r in math_rows],.95),
        'inputTokens':sum(r['usage']['inputTokens'] for r in rows if r['usage']),'outputTokens':sum(r['usage']['outputTokens'] for r in rows if r['usage']),'usageKnown':sum(r['usage'] is not None for r in rows),'providerAttemptsExpected':sum(r['providerAttempted'] for r in rows)}
    gates={k:summary[k] is not None and (summary[k]<=v if k.endswith('Ms') else summary[k]>=v) for k,v in suite['thresholds'].items()}
    return {'schemaVersion':'1.0','summary':summary,'gates':gates,'passed':all(gates.values()),'cases':rows}

def manifest(suite,mode,runtime,gateway):
    paths=['backend/src/main/resources/ai/templates/canvas-edit-v2.txt','backend/src/main/java/dev/researchhub/analysis/application/ProblemService.java','contracts/document/math/v1/math.schema.json','contracts/analysis/computation-plan/v2/problem.schema.json','contracts/ai/authoring/v2/authoring.schema.json','sandbox/runtime/problem.py','sandbox/runtime/verify_problem.py','sandbox/Dockerfile','sandbox/requirements.lock','ai-worker/src/researchhub_worker/evaluation/canvas.py','contracts/analysis/execution/v3/solution.schema.json','contracts/document/report/v2/report.schema.json']
    return {'timestamp':datetime.now(timezone.utc).isoformat(),'mode':mode,'suiteId':suite['id'],'suiteVersion':suite['version'],'datasetHash':digest(suite),'model':gateway.model_metadata().model_dump(mode='json',by_alias=True),
        'imageId':runtime.image,'runtimeVersion':'1.2.0','promptHashes':{'problem-plan:2':digest(problem_prompt().encode()),'canvas-edit:2':digest((ROOT/paths[0]).read_bytes())},'hashes':{p:digest((ROOT/p).read_bytes()) for p in paths},'hardware':{'platform':platform.platform(),'machine':platform.machine(),'processor':platform.processor(),'cpuCount':os.cpu_count(),'python':platform.python_version()},'oracle':'stdlib-fraction-quadratic-residual-v1','entailment':'curated-full-statement-and-cited-passage-v1','cost':'unknown','skipCount':0}

def write_report(output,result):
    write_json(output,result)
    lines=['# Canvas AI fixed benchmark','',f"Mode: {result['manifest']['mode']}; {len(result['cases'])} cases; skipped: 0.",f"Model: {result['manifest']['model']}; image: `{result['manifest']['imageId']}`.",'','| Metric | Value |','| --- | ---: |']+[f'| {k} | {v} |' for k,v in result['summary'].items()]
    lines+=['',f"Gates: {result['gates']}",f"Known usage cost USD: {result['manifest']['cost']}. Configured rate, not an invoice. Completeness: {result['manifest'].get('costCompleteness','unknown')}.",'','Arithmetic uses an independent standard-library oracle. Grounded support uses full-statement curated rules against the cited passage, measured separately from citation membership. It does not prove arbitrary semantic entailment. Offline measurements are deterministic fixtures, not Gemini quality.','', '| Case | Expected | Correct | Error |','| --- | --- | --- | --- |']+[f"| {r['id']} | {r['expected']} | {r['correct']} | {r['error'] or ''} |" for r in result['cases']]
    if 'rescoring' in result:lines+=['', 'Language scoring was reviewed from the archived normalized answers, without new model/runtime calls. The original summary, gates and measurement hashes are retained in this JSON.', f"Original grounded support: {result['measurementSummary']['groundedSupport']}; rescoring: {result['rescoring']}"]
    output.with_suffix('.md').write_text('\n'.join(lines)+'\n')

def rescore(source,measured,suite):
    """Review revised finite language annotations without repeating paid/model/runtime work."""
    from ..ai.authoring import AuthoringAnswer
    original=json.loads(source.read_text());previous=json.loads(measured.read_text())
    if digest(previous)!=original['manifest']['datasetHash'] or previous['thresholds']!=suite['thresholds']:
        raise ValueError('Measurement dataset or gates changed')
    if len(previous['cases'])!=len(suite['cases']) or [r['id'] for r in original['cases']]!=[r['id'] for r in suite['cases']]:
        raise ValueError('Case identity changed')
    for before,after in zip(previous['cases'],suite['cases']):
        a=copy.deepcopy(before);b=copy.deepcopy(after)
        if a['action']=='EDIT' and a['evidence']:
            a['oracle'].pop('supportedStatements');b['oracle'].pop('supportedStatements')
        if a!=b:raise ValueError('Only grounded language annotations may be rescored')
    result=copy.deepcopy(original);result['measurementSummary']=original['summary'];result['measurementGates']=original['gates']
    result['rescoring']={'timestamp':datetime.now(timezone.utc).isoformat(),'sourceReportHash':digest(source.read_bytes()),'measuredDatasetHash':digest(previous),
        'datasetHash':digest(suite),'suiteVersion':suite['version'],'scorerHash':digest(Path(__file__).read_bytes()),'reason':'Finite reporting-verb/paraphrase annotations for the same cited facts; inputs and gates unchanged; zero new provider/runtime calls'}
    grounded=[]
    for row,case in zip(result['cases'],suite['cases']):
        if case['action']=='EDIT' and case['evidence']:
            score=0.0;row['correct']=False
            if row['normalizedResult'] is not None:
                answer=AuthoringAnswer.model_validate(row['normalizedResult']);request=author_request(case)
                if not set(answer.citation_ids)<=set(v.chunk_id for v in request.request.evidence):raise ValueError('Reference changed')
                score=grounded_support(case,answer.text,answer.citation_ids)
                numbers=set(re.findall(r'\d+(?:[.,]\d+)?',answer.text))
                row['correct']=row['schemaValid'] and answer.status=='READY' and numbers==set(map(str,case['oracle']['requiredNumbers'])) and score==1
            row['groundedSupport']=score;grounded.append(score)
    result['summary']['groundedSupport']=sum(grounded)/len(grounded)
    result['summary']['unsupportedClaimRate']=1-result['summary']['groundedSupport']
    result['gates']['groundedSupport']=result['summary']['groundedSupport']>=suite['thresholds']['groundedSupport'];result['passed']=all(result['gates'].values())
    if original['manifest']['providerCalls']>original['summary']['usageKnown']:
        result['manifest']['costCompleteness']='partial; failed HTTP transports have unknown billed usage'
    return result

def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--mode',choices=['offline','live'],default='offline');parser.add_argument('--output',type=Path,required=True);parser.add_argument('--rescore-from',type=Path);parser.add_argument('--measured-dataset',type=Path);args=parser.parse_args(argv)
    runtime=None
    try:
        suite=json.loads(FIXTURE.read_text())
        if args.rescore_from or args.measured_dataset:
            if not (args.rescore_from and args.measured_dataset):raise ValueError('Rescoring requires the frozen measured dataset')
            result=rescore(args.rescore_from,args.measured_dataset,suite);write_report(args.output,result)
            return 0 if result['passed'] else 1
        runtime=DockerRuntime()
        # Verify the owned pinned image and both phases before any paid transport.
        probe=problem_request(next(v for v in suite['cases'] if v['action']=='PROBLEM' and v['expected']=='CHECKED'))
        plan=Plan.model_validate_json(ModelGateway(FakeModelProvider()).plan_problem(probe).output)
        runtime.calculate(probe,plan)
        if args.mode=='live':
            if not os.getenv('GEMINI_API_KEY'):raise ValueError('Live mode requires GEMINI_API_KEY')
            gateway=live_gateway();tracking=TrackingOpener(gateway._provider._opener);gateway._provider._opener=tracking
        else:gateway=ModelGateway(FakeModelProvider());tracking=None
        frozen_manifest=manifest(suite,args.mode,runtime,gateway)
        result=run(suite,gateway,runtime,lambda value:print(json.dumps(value),flush=True));result['manifest']=frozen_manifest
        result['manifest']['providerCalls']=tracking.calls if tracking else 0;result['manifest']['observedModelRevisions']=sorted(tracking.revisions) if tracking else []
        matrix=json.loads((ROOT/'docs/evaluation/models/demo-matrix.json').read_text());pricing=next((v.get('pricing') for v in matrix['candidates'] if v['model']==result['manifest']['model']['name']),None)
        if pricing and args.mode=='live':
            result['manifest']['pricing']=pricing;result['manifest']['cost']=result['summary']['inputTokens']*pricing['inputPerMillion']/1e6+result['summary']['outputTokens']*pricing['outputPerMillion']/1e6
            result['manifest']['costCompleteness']='complete' if result['summary']['usageKnown']==result['summary']['providerAttemptsExpected'] and tracking.calls==result['summary']['usageKnown'] else 'partial; failed transport calls may have unknown billed usage'
        write_report(args.output,result);return 0 if result['passed'] else 1
    except (ValueError,RuntimeError,OSError,KeyError,subprocess.SubprocessError):
        print('Canvas evaluation unavailable: verify pinned runtime, fixtures and explicit live credentials. No evidence accepted.');return 2
    finally:
        if runtime is not None:getattr(runtime,'close',lambda:None)()

if __name__=='__main__':raise SystemExit(main())
