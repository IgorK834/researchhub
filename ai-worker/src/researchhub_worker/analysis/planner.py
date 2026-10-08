"""One model attempt. Spring owns the durable, three-attempt budget and application authorization."""
import hashlib
import json
from .contracts import Candidate, PlanningRequest, PLAN_SCHEMA
from ..ai.contracts import UsageMetadata
from ..ai.providers import ProviderError, FakeModelProvider
from .deterministic import impedance_plan
from .rc_fixture import rc_plan


def generate_candidate(provider, request):
    request = PlanningRequest.model_validate(request.model_dump())
    try:
        metadata = provider.model_metadata()
        if isinstance(provider, FakeModelProvider):
            # The narrow known fixture generates a program; it never calculates from preview rows.
            inputs = []
            for inspected in request.inputs:
                selection = inspected.selection
                for sheet in inspected.preview.sheets:
                    if (selection.sheet_name is None or sheet.name == selection.sheet_name) and sheet.columns:
                        inputs.append({'sourceVersionId': str(selection.source_version_id), 'sheetName': sheet.name,
                                       'requiredColumns': selection.columns or [c.index for c in sheet.columns]})
            if not inputs:
                raise ProviderError('AI_OUTPUT_INVALID')
            fixture = impedance_plan(request) or rc_plan(request)
            output = json.dumps(fixture or {'schemaVersion': '1.0', 'summary': 'Offline planning fixture; configure a model for this computation.',
                'inputs': inputs, 'transformations': [], 'statisticalOperations': [],
                'outputs': [{'kind': 'TEXT', 'name': 'planning-note', 'description': 'Offline fixture only.',
                             'sourceVersionIds': list(dict.fromkeys(i['sourceVersionId'] for i in inputs))}],
                'assumptions': [], 'warnings': ['Deterministic fixture: no computation was generated or executed.'],
                'code': {'language': 'PYTHON', 'source': "raise RuntimeError('Offline planning fixture; configure a model')"}})
            input_tokens = len(request.user_message().split())
            usage = UsageMetadata(input_tokens=input_tokens, output_tokens=len(output.split()),
                                  total_tokens=input_tokens + len(output.split()), estimated=True)
            provider_id = hashlib.sha256(output.encode()).hexdigest()
        else:
            payload = provider.complete(request, PLAN_SCHEMA, 'researchhub_computation_plan_v1')
            output = payload['choices'][0]['message']['content']
            usage = UsageMetadata(input_tokens=payload['usage']['prompt_tokens'], output_tokens=payload['usage']['completion_tokens'],
                                  total_tokens=payload['usage']['total_tokens'], estimated=False)
            provider_id = payload['id']
        # Retain bounded raw JSON for the application audit, including structurally invalid candidates.
        # The public API validates Plan + references and never approves invalid candidates for execution.
        return Candidate(schema_version='1.0', request_id=request.request.request_id, model=metadata,
                         usage=usage, provider_request_id=provider_id, output=output)
    except ProviderError:
        raise
    except (ValueError, KeyError, TypeError, AttributeError, IndexError):
        raise ProviderError('AI_OUTPUT_INVALID') from None
    except Exception:
        raise ProviderError('AI_PROVIDER_ERROR') from None
