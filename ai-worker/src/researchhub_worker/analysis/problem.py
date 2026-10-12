"""PROBLEM planning only. Expressions are inert JSON; numerical execution belongs to Docker."""
import hashlib
import json
import re
from typing import Literal, Any
from uuid import UUID
from pydantic import Field, model_validator
from ..contract_model import ContractModel
from ..ai.contracts import GenerationRequest, UsageMetadata
from ..ai.providers import FakeModelProvider, ProviderError
from .contracts import Candidate

UNITS = {'1','m','cm','km','s','ms','kg','g','m/s','m/s^2','N','J','Pa','rad','deg','A','mA','V','ohm','kohm','W','mW'}
DECIMAL = re.compile(r'-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?\Z')
SYMBOL = re.compile(r'[A-Za-z][A-Za-z0-9]{0,15}\Z')

def validate_ast(value):
    count = [0]
    def walk(n, depth):
        count[0] += 1
        if type(n) is not dict or depth > 12 or count[0] > 128:
            raise ValueError('AST limit')
        op = n.get('op')
        expected = {'number':{'op','value'}, 'symbol':{'op','name'}, 'add':{'op','args'}, 'mul':{'op','args'},
                    'eq':{'op','left','right'}, 'div':{'op','left','right'}, 'pow':{'op','base','exponent'},
                    'sqrt':{'op','arg'}, 'sin':{'op','arg'}, 'cos':{'op','arg'}}
        if op not in expected or set(n) != expected[op]:
            raise ValueError('Closed AST')
        if op == 'number':
            decimal(n['value'])
        elif op == 'symbol':
            if type(n['name']) is not str or not SYMBOL.fullmatch(n['name']): raise ValueError('Symbol')
        elif op in {'add','mul'}:
            if type(n['args']) is not list or not 2 <= len(n['args']) <= 8: raise ValueError('Operands')
            for child in n['args']: walk(child,depth+1)
        elif op in {'eq','div'}:
            walk(n['left'],depth+1); walk(n['right'],depth+1)
        elif op == 'pow':
            if type(n['exponent']) is not int or abs(n['exponent']) > 8: raise ValueError('Power')
            walk(n['base'],depth+1)
        else: walk(n['arg'],depth+1)
    walk(value,0)
    return value

def decimal(v):
    if type(v) is not str or len(v)>40 or not DECIMAL.fullmatch(v) or v=='-0' or re.search(r'\.\d*0$',v): raise ValueError('Canonical decimal')
    return v

class Parameter(ContractModel):
    symbol: str = Field(pattern=r'^[A-Za-z][A-Za-z0-9]{0,15}$')
    value: str | None
    unit: str | None
    @model_validator(mode='after')
    def valid(self):
        if self.value is not None: decimal(self.value)
        if self.unit is not None and self.unit not in UNITS: raise ValueError('Unit')
        return self

class Unknown(ContractModel):
    symbol: str = Field(pattern=r'^[A-Za-z][A-Za-z0-9]{0,15}$')
    unit: str | None
    @model_validator(mode='after')
    def valid(self):
        if self.unit is not None and self.unit not in UNITS: raise ValueError('Unit')
        return self

class Output(ContractModel):
    name: str = Field(pattern=r'^[A-Za-z][A-Za-z0-9-]{0,79}$')
    kind: Literal['EVALUATE','SOLVE']
    expression: dict[str,Any] | None
    unit: str | None
    @model_validator(mode='after')
    def valid(self):
        if self.expression is not None: validate_ast(self.expression)
        if self.unit is not None and self.unit not in UNITS: raise ValueError('Unit')
        return self

class Plot(ContractModel):
    parameter: str = Field(pattern=r'^[A-Za-z][A-Za-z0-9]{0,15}$')
    start: str
    end: str
    points: int = Field(strict=True, ge=2, le=201)
    output: str = Field(min_length=1,max_length=80)
    @model_validator(mode='after')
    def valid(self):
        from decimal import Decimal
        decimal(self.start); decimal(self.end)
        if Decimal(self.start)>=Decimal(self.end): raise ValueError('Plot range')
        return self

class Problem(ContractModel):
    statement: str = Field(min_length=1,max_length=4000)
    parameters: list[Parameter] = Field(max_length=20)
    unknowns: list[Unknown] = Field(max_length=1)
    domain: Literal['REAL'] | None
    expected_outputs: list[Output] = Field(max_length=8)
    assumptions: list[str] = Field(max_length=12)
    plot: Plot | None
    @model_validator(mode='after')
    def valid(self):
        names=[p.symbol for p in self.parameters]+[p.symbol for p in self.unknowns]
        if len(set(names))!=len(names) or len({o.name for o in self.expected_outputs})!=len(self.expected_outputs): raise ValueError('Duplicate symbol/output')
        if not self.statement.strip() or any(not a.strip() or len(a)>500 for a in self.assumptions): raise ValueError('Text')
        return self

    @classmethod
    def model_json_schema(cls, **kwargs):
        from .problem_ast_schema import MATH_AST_SCHEMA
        schema=super().model_json_schema(**kwargs)
        schema.setdefault('$defs',{})['MathAst']=MATH_AST_SCHEMA
        schema['$defs']['Output']['properties']['expression']={'anyOf':[{'$ref':'#/$defs/MathAst'},{'type':'null'}]}
        return schema

class Plan(ContractModel):
    schema_version: Literal['2.0']
    workload: Literal['PROBLEM']
    problem_hash: str = Field(pattern=r'^[a-f0-9]{64}$')
    summary: str = Field(min_length=1,max_length=2000)
    outputs: list[Output] = Field(max_length=8)
    assumptions: list[str] = Field(max_length=12)
    warnings: list[str] = Field(max_length=12)
    clarifications: list[str] = Field(max_length=12)
    @classmethod
    def model_json_schema(cls, **kwargs):
        from .problem_ast_schema import MATH_AST_SCHEMA
        schema=super().model_json_schema(**kwargs)
        schema.setdefault('$defs',{})['MathAst']=MATH_AST_SCHEMA
        schema['$defs']['Output']['properties']['expression']={'anyOf':[{'$ref':'#/$defs/MathAst'},{'type':'null'}]}
        return schema

    @model_validator(mode='after')
    def bounded(self):
        if any(not s.strip() or len(s)>500 for s in self.assumptions+self.warnings+self.clarifications): raise ValueError('Notes')
        return self
    def validate_for(self,request):
        if self.problem_hash!=request.problem_hash or self.outputs!=request.problem.expected_outputs or self.assumptions!=request.problem.assumptions: raise ValueError('Frozen problem mismatch')
        return self

class PlanningRequest(ContractModel):
    schema_version: Literal['2.0']
    analysis_id: UUID
    request: GenerationRequest
    problem: Problem
    problem_hash: str = Field(pattern=r'^[a-f0-9]{64}$')
    @model_validator(mode='after')
    def valid(self):
        if self.request.template_id!='problem-plan:2' or self.request.evidence: raise ValueError('Problem template')
        return self
    @classmethod
    def model_json_schema(cls, **kwargs):
        from .problem_ast_schema import MATH_AST_SCHEMA
        schema=super().model_json_schema(**kwargs)
        schema.setdefault('$defs',{})['MathAst']=MATH_AST_SCHEMA
        schema['$defs']['Output']['properties']['expression']={'anyOf':[{'$ref':'#/$defs/MathAst'},{'type':'null'}]}
        return schema

    def user_message(self):
        return json.dumps(self.model_dump(mode='json',by_alias=True),ensure_ascii=False,separators=(',',':'))

def generate_candidate(provider,request):
    request=PlanningRequest.model_validate(request.model_dump())
    try:
        if isinstance(provider,FakeModelProvider):
            plan=Plan(schema_version='2.0',workload='PROBLEM',problem_hash=request.problem_hash,
                      summary='Compute the explicitly supplied formulas in the isolated scientific runtime.',
                      outputs=request.problem.expected_outputs,assumptions=request.problem.assumptions,warnings=[],clarifications=['Supply missing parameters, units, domain or expressions.'] if request.problem.domain is None or any(p.value is None or p.unit is None for p in request.problem.parameters) or any(o.expression is None or o.unit is None for o in request.problem.expected_outputs) else [])
            output=plan.model_dump_json(by_alias=True)
            tokens=len(request.user_message().split())
            usage=UsageMetadata(input_tokens=tokens,output_tokens=len(output.split()),total_tokens=tokens+len(output.split()),estimated=True)
            provider_id=hashlib.sha256(output.encode()).hexdigest()
        else:
            payload=provider.complete(request,Plan.model_json_schema(by_alias=True),'researchhub_problem_plan_v2')
            output=payload['choices'][0]['message']['content']
            usage=UsageMetadata(input_tokens=payload['usage']['prompt_tokens'],output_tokens=payload['usage']['completion_tokens'],total_tokens=payload['usage']['total_tokens'],estimated=False)
            provider_id=payload['id']
        return Candidate(schema_version='1.0',request_id=request.request.request_id,model=provider.model_metadata(),usage=usage,provider_request_id=provider_id,output=output)
    except ProviderError: raise
    except (ValueError,KeyError,TypeError,AttributeError,IndexError): raise ProviderError('AI_OUTPUT_INVALID') from None
    except Exception: raise ProviderError('AI_PROVIDER_ERROR') from None
