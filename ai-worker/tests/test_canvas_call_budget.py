"""Real native HTTP adapter against deterministic transport failures; never live Gemini."""
import pytest
from researchhub_worker.ai.call_budget import scope, admit
from researchhub_worker.ai.providers import ModelGateway, ProviderError
from researchhub_worker.ai.telemetry import invoke
from test_gemini import endpoint, provider, response
from test_canvas_authoring import ROOT
from researchhub_worker.ai.context import ContextualRequest


def test_scope_is_shared_nested_and_reset_after_failure():
    with scope(1), scope(99):
        admit()
        with pytest.raises(ProviderError) as failure:
            admit()
        assert failure.value.code == 'AI_OUTPUT_INVALID'
    with scope(1):
        admit()
    admit()  # unrelated unbudgeted adapter operation


def test_canvas_transport_retries_and_repair_share_three_calls(endpoint):
    request=ContextualRequest.model_validate_json((ROOT / "model-request.json").read_text())
    endpoint.responses=[(503,{}),(400,{'error':{'message':'schema unsupported'}}),(200,response('{}')),(200,response())]
    gateway=ModelGateway(provider(endpoint),sleep=lambda _:None)
    with pytest.raises(ProviderError) as failure:
        invoke(gateway,gateway.generate_structured,request)
    assert len(endpoint.calls)==3
    assert failure.value.code in {'AI_UNAVAILABLE','AI_OUTPUT_INVALID'}
