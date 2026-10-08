import copy
import json
from pathlib import Path
from types import SimpleNamespace as NS
import pytest
from researchhub_worker.analysis.contracts import PlanningRequest, Plan
from researchhub_worker.analysis.rc_fixture import rc_plan, _code
from researchhub_worker.ai.providers import FakeModelProvider, ModelGateway


def request():
    payload = json.loads(Path('../contracts/analysis/computation-plan/v1/request.json').read_text())
    payload['request']['instruction'] = 'Estimate tau for this RC discharge and plot measured versus fitted voltage.'
    inspected = payload['inputs'][0]
    inspected['preview']['format'] = 'XLSX'
    inspected['preview']['originalFilename'] = 'rc-measurements.xlsx'
    inspected['preview']['sheets'][0]['columns'][0]['name'] = 'time_s'
    inspected['preview']['sheets'][0]['columns'][1]['name'] = 'voltage_v'
    return PlanningRequest.model_validate(payload)


def mutable(value):
    if isinstance(value, dict):
        return NS(**{key: mutable(item) for key, item in value.items()})
    if isinstance(value, list):
        return [mutable(item) for item in value]
    return value


def test_deterministic_rc_plan_is_bound_to_immutable_full_data_and_existing_wire_contract():
    value = request()
    candidate = ModelGateway(FakeModelProvider()).plan_computation(value)
    plan = Plan.model_validate_json(candidate.output)
    plan.validate_for(value)
    assert [output.name for output in plan.outputs] == ['rc-fit-table', 'rc-discharge-chart', 'rc-fit-summary']
    assert plan.statistical_operations[0].columns == [1, 2]
    assert '/inputs/' + str(value.inputs[0].selection.source_version_id) + '.xlsx' in plan.code.source
    assert 'np.polyfit' in plan.code.source and 'records[1:]' in plan.code.source
    assert 'data_only=False' in plan.code.source
    assert 'voltage positive' in plan.code.source and 'Measurement row limit' in plan.code.source
    assert 'additive' in ' '.join(plan.assumptions).lower()
    # No generated source is executed in the worker or these unit tests.


@pytest.mark.parametrize('change', ['instruction', 'multiple', 'format', 'header', 'selection', 'missing', 'ambiguous', 'unselected'])
def test_rc_fixture_refuses_unsupported_or_ambiguous_inputs(change):
    value = mutable(request().model_dump())
    if change == 'instruction':
        value.request.instruction = 'Summarize this data'
    elif change == 'multiple':
        value.inputs.append(copy.deepcopy(value.inputs[0]))
    elif change == 'format':
        value.inputs[0].preview.format = 'CSV'
    elif change == 'header':
        value.inputs[0].preview.sheets[0].header_row = None
    elif change == 'selection':
        value.inputs[0].selection.sheet_name = 'Other'
    elif change == 'missing':
        value.inputs[0].preview.sheets[0].columns[0].name = 'unknown'
    elif change == 'ambiguous':
        value.inputs[0].selection.sheet_name = None
        value.inputs[0].preview.sheets.append(copy.deepcopy(value.inputs[0].preview.sheets[0]))
    elif change == 'unselected':
        value.inputs[0].selection.columns = [2]
    assert rc_plan(value) is None


def test_explicit_time_constant_wording_and_literal_sheet_names_are_inert():
    value = mutable(request().model_dump())
    value.request.instruction = 'RC time constant fit'
    value.inputs[0].selection.columns = None
    assert rc_plan(value)
    code = _code('/inputs/fixed.xlsx', "quote' and newline\n", 1, [0, 1])
    assert repr("quote' and newline\n") in code
