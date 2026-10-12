"""Controlled bounded CAS entrypoint. No eval/sympify/parse_expr, generated modules or application access."""
import hashlib
import json
import math
import re
import sys
from pathlib import Path
import sympy as sp
sys.path.insert(0, '/opt/researchhub')
from protocol import load_json, regular_file, keys, reject, validate_result

DECIMAL = re.compile(r'-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?\Z')
SYMBOL = re.compile(r'[A-Za-z][A-Za-z0-9]{0,15}\Z')
UNITS = {'1':((0,0,0,0),'1'), 'm':((1,0,0,0),'1'),'cm':((1,0,0,0),'0.01'),'km':((1,0,0,0),'1000'),
 's':((0,0,1,0),'1'),'ms':((0,0,1,0),'0.001'),'kg':((0,1,0,0),'1'),'g':((0,1,0,0),'0.001'),
 'm/s':((1,0,-1,0),'1'),'m/s^2':((1,0,-2,0),'1'),'N':((1,1,-2,0),'1'),'J':((2,1,-2,0),'1'),'Pa':((-1,1,-2,0),'1'),
 'A':((0,0,0,1),'1'),'mA':((0,0,0,1),'0.001'),'V':((2,1,-3,-1),'1'),
 'ohm':((2,1,-3,-2),'1'),'kohm':((2,1,-3,-2),'1000'),'W':((2,1,-3,0),'1'),'mW':((2,1,-3,0),'0.001'),
 'rad':((0,0,0,0),'1'),'deg':((0,0,0,0),None)}
TOLERANCE={'absolute':1e-10,'relative':1e-10}


def rational(v):
    if type(v) is not str or len(v)>40 or not DECIMAL.fullmatch(v) or v=='-0' or re.search(r'\.\d*0$',v): reject()
    negative=v.startswith('-');v=v.lstrip('-');whole,_,part=v.partition('.')
    return sp.Rational((-1 if negative else 1)*int(whole+part),10**len(part))


def factor(unit):
    if unit not in UNITS: reject()
    return sp.pi/180 if unit=='deg' else rational(UNITS[unit][1])


def ast(n,symbols,depth=0,budget=None):
    budget=budget if budget is not None else [0];budget[0]+=1
    if type(n) is not dict or depth>12 or budget[0]>128: reject()
    op=n.get('op')
    def child(v): return ast(v,symbols,depth+1,budget)
    if op=='number':
        keys(n,('op','value'));return rational(n['value']), (0,0,0,0)
    if op=='symbol':
        keys(n,('op','name'))
        if n['name'] not in symbols: reject()
        return symbols[n['name']]
    if op in ('add','mul'):
        keys(n,('op','args'))
        if type(n['args']) is not list or not 2<=len(n['args'])<=8: reject()
        values=[child(v) for v in n['args']]
        if op=='add':
            if any(d!=values[0][1] for _,d in values): reject()
            return sp.Add(*(v for v,_ in values),evaluate=False),values[0][1]
        return sp.Mul(*(v for v,_ in values),evaluate=False),tuple(sum(d[i] for _,d in values) for i in range(4))
    if op=='eq' and depth!=0: reject()
    if op in ('div','eq'):
        keys(n,('op','left','right'));a,ad=child(n['left']);b,bd=child(n['right'])
        if op=='eq':
            if ad!=bd: reject()
            return sp.Add(a,-b,evaluate=False),ad
        if b.is_zero: reject()
        return sp.Mul(a,sp.Pow(b,-1,evaluate=False),evaluate=False),tuple(ad[i]-bd[i] for i in range(4))
    if op=='pow':
        keys(n,('op','base','exponent'));e=n['exponent']
        if type(e) is not int or abs(e)>8: reject()
        a,d=child(n['base'])
        if a.is_zero and e<=0: reject()
        return sp.Pow(a,e,evaluate=False),tuple(x*e for x in d)
    if op in ('sqrt','sin','cos'):
        keys(n,('op','arg'));a,d=child(n['arg'])
        if op=='sqrt':
            if any(x%2 for x in d): reject()
            return sp.Pow(a,sp.Rational(1,2),evaluate=False),tuple(x//2 for x in d)
        if d!=(0,0,0,0): reject()
        return (sp.sin if op=='sin' else sp.cos)(a,evaluate=False),d
    reject()


def complexity(n,depth=0):
    if type(n) is not dict or depth>12: reject()
    op=n.get('op')
    if op=='number': c=len(n['value'])
    elif op=='symbol': c=1
    elif op in ('add','mul'): c=sum(complexity(a,depth+1) for a in n['args'])
    elif op in ('eq','div'): c=complexity(n['left'],depth+1)+complexity(n['right'],depth+1)
    elif op=='pow': c=complexity(n['base'],depth+1)*max(1,abs(n['exponent']))
    elif op in ('sqrt','sin','cos'): c=complexity(n['arg'],depth+1)*2
    else: reject()
    if c>2048: reject()
    return c


def finite(expr):
    if expr.free_symbols: reject()
    try:
        value=float(expr.evalf(25))
    except (ValueError,TypeError,OverflowError): reject()
    if not math.isfinite(value) or abs(value)>1e100: reject()
    return value


def compute(snapshot,plan):
    keys(snapshot,('schemaVersion','problem','origin','inputHash','templateId','templateHash'))
    if snapshot['schemaVersion']!='2.0' or snapshot['templateId']!='problem-plan:2': reject()
    keys(plan,('schemaVersion','workload','problemHash','summary','outputs','assumptions','warnings','clarifications'))
    p=snapshot['problem'];keys(p,('statement','parameters','unknowns','domain','expectedOutputs','assumptions','plot'))
    if p['domain']!='REAL' or plan['schemaVersion']!='2.0' or plan['workload']!='PROBLEM' or plan['problemHash']!=snapshot['inputHash'] or plan['outputs']!=p['expectedOutputs'] or plan['assumptions']!=p['assumptions'] or plan['clarifications']: reject()
    if type(p['parameters']) is not list or len(p['parameters'])>20 or type(p['unknowns']) is not list or len(p['unknowns'])>1 or not 1<=len(plan['outputs'])<=8: reject()
    symbols={};sub={};given={}
    for item in p['parameters']+p['unknowns']:
        keys(item,('symbol','value','unit') if 'value' in item else ('symbol','unit'))
        name=item['symbol'];unit=item['unit']
        if type(name) is not str or not SYMBOL.fullmatch(name) or name in symbols or unit not in UNITS: reject()
        s=sp.Symbol(name,real=True);symbols[name]=(s,UNITS[unit][0])
        if 'value' in item:
            sub[s]=rational(item['value'])*factor(unit);given[name]={'value':item['value'],'unit':unit,'siValue':str(sub[s])}
    outputs=[];expressions={};names=set()
    for o in plan['outputs']:
        keys(o,('name','kind','expression','unit'))
        if o['name'] in names or not re.fullmatch(r'[A-Za-z][A-Za-z0-9-]{0,79}',o['name']) or o['unit'] not in UNITS: reject()
        names.add(o['name']);complexity(o['expression']);expr,d=ast(o['expression'],symbols);expressions[o['name']]=expr
        if o['kind']=='EVALUATE':
            if o['expression']['op']=='eq' or d!=UNITS[o['unit']][0]: reject()
            values=[finite(expr.subs(sub)/factor(o['unit']))]
        elif o['kind']=='SOLVE':
            if o['expression']['op']!='eq' or len(p['unknowns'])!=1 or o['unit']!=p['unknowns'][0]['unit']: reject()
            unknown=symbols[p['unknowns'][0]['symbol']][0];resolved=expr.subs(sub)
            # Only rational-coefficient polynomials, degree 1..4. No general simplify/solve or matrices.
            try: poly=sp.Poly(resolved,unknown)
            except sp.PolynomialError: reject()
            if not 1<=poly.degree()<=4 or any(not c.is_Rational or abs(c.p)>10**80 or c.q>10**80 for c in poly.all_coeffs()): reject()
            roots=poly.all_roots(radicals=True)
            values=sorted(set(finite(v/factor(o['unit'])) for v in roots if v.is_real is True))
            if not values: reject()
            for value in values:
                residual=finite(resolved.subs(unknown,sp.Float(value,25)*factor(o['unit'])))
                if abs(residual)>1e-7: reject()
        else: reject()
        outputs.append({'name':o['name'],'kind':o['kind'],'expression':o['expression'],'unit':o['unit'],'values':values,
                        'steps':[{'operation':o['kind'],'expression':o['expression'],'substitution':given,'values':values,'unit':o['unit']}]})
    series=None
    if p['plot'] is not None:
        q=p['plot'];keys(q,('parameter','start','end','points','output'))
        if type(q['points']) is not int or not 2<=q['points']<=201 or q['parameter'] not in given: reject()
        o=next((o for o in plan['outputs'] if o['name']==q['output'] and o['kind']=='EVALUATE'),None)
        if o is None: reject()
        a,b=rational(q['start']),rational(q['end'])
        if a>=b: reject()
        unit=given[q['parameter']]['unit'];symbol=symbols[q['parameter']][0];points=[]
        for i in range(q['points']):
            x=a+(b-a)*sp.Rational(i,q['points']-1);values=dict(sub);values[symbol]=x*factor(unit)
            points.append([finite(x),finite(expressions[o['name']].subs(values)/factor(o['unit']))])
        series={'parameter':q['parameter'],'output':q['output'],'xUnit':unit,'yUnit':o['unit'],'points':points}
    return {'schemaVersion':'2.0','workload':'PROBLEM','inputHash':snapshot['inputHash'],'outputs':outputs,'plot':series}


def compare(actual,expected):
    if type(expected) in (int,float):
        if type(actual) not in (int,float) or not math.isfinite(actual) or not math.isclose(actual,expected,rel_tol=TOLERANCE['relative'],abs_tol=TOLERANCE['absolute']): reject()
    elif type(expected) is dict:
        keys(actual,expected.keys())
        for k,v in expected.items(): compare(actual[k],v)
    elif type(expected) is list:
        if type(actual) is not list or len(actual)!=len(expected): reject()
        for a,b in zip(actual,expected): compare(a,b)
    elif actual!=expected: reject()


def execute(verify=False,execution_root=Path('/execution'),inputs_root=Path('/inputs'),outputs_root=Path('/outputs')):
    manifest=load_json(execution_root/'manifest.json',65536);keys(manifest,('schemaVersion','workload','phase','files','outputs'))
    if manifest['schemaVersion']!='2.0' or manifest['workload']!='PROBLEM' or manifest['phase']!=('VERIFY' if verify else 'COMPUTE') or any(outputs_root.iterdir()): reject()
    expected={'problem.json','plan.json','candidate.json'} if verify else {'problem.json','plan.json'}
    if type(manifest['files']) is not list or {x.get('name') for x in manifest['files']}!=expected or len(manifest['files'])!=len(expected): reject()
    loaded={};hashes={}
    for item in manifest['files']:
        keys(item,('name','file','sha256'));name=item['name']
        if item['file']!='/inputs/'+name: reject()
        raw=regular_file(inputs_root/name,131072)
        if hashlib.sha256(raw).hexdigest()!=item['sha256']: reject()
        loaded[name]=load_json(inputs_root/name,131072);hashes[name]=item['sha256']
    calculated=compute(loaded['problem.json'],loaded['plan.json'])
    if verify:
        compare(loaded['candidate.json'],calculated)
        receipt={'schemaVersion':'2.0','phase':'VERIFY','status':'CHECKED','inputHash':calculated['inputHash'],
                 'problemSha256':hashes['problem.json'],'planSha256':hashes['plan.json'],'candidateSha256':hashes['candidate.json'],
                 'tolerance':TOLERANCE,'checkedOutputs':len(calculated['outputs']), 'checkedPoints':len(calculated['plot']['points']) if calculated['plot'] else 0}
        outputs=[{'name':'verification','kind':'TEXT','text':json.dumps(receipt,separators=(',',':'),allow_nan=False)}]
    else:
        outputs=[{'name':'calculation','kind':'TEXT','text':json.dumps(calculated,separators=(',',':'),allow_nan=False)}]
        if calculated['plot']:
            series=calculated['plot'];points=series['points'];outputs.append({'name':'plot-data','kind':'TABLE','columns':['x','y'],'rows':points})
            import matplotlib
            matplotlib.use('Agg')
            import matplotlib.pyplot as plt
            fig,axis=plt.subplots(figsize=(6,4));axis.plot([p[0] for p in points],[p[1] for p in points]);axis.set_xlabel(series['parameter']+' ('+series['xUnit']+')');axis.set_ylabel(series['output']+' ('+series['yUnit']+')');fig.tight_layout();fig.savefig(outputs_root/'plot.png');plt.close(fig)
            outputs.append({'name':'plot','kind':'CHART','file':'plot.png','title':series['output'],
                'xAxis':{'label':series['parameter'],'unit':series['xUnit'],'scale':'LINEAR'},'yAxis':{'label':series['output'],'unit':series['yUnit'],'scale':'LINEAR'},
                'series':[{'name':series['output'],'tableName':'plot-data','xColumn':'x','yColumn':'y','yTransform':'IDENTITY'}]})
    (outputs_root/'result.json').write_text(json.dumps({'schemaVersion':'2.0','outputs':outputs},separators=(',',':'),allow_nan=False))
    validate_result({'outputs':manifest['outputs']},outputs_root)


def main(verify=False):
    try:
        if len(sys.argv)!=1: reject()
        execute(verify)
        return 0
    except Exception:
        print('PROBLEM_CALCULATION_INVALID',file=sys.stderr,flush=True)
        return 65

if __name__=='__main__': sys.exit(main())
