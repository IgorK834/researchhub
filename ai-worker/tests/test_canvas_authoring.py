import json
from pathlib import Path
from unittest.mock import Mock
import pytest
from researchhub_worker.ai.context import ContextualRequest
from researchhub_worker.ai.providers import FakeModelProvider, ModelGateway, ProviderError
from researchhub_worker.ai.authoring import AuthoringResult

ROOT = Path(__file__).resolve().parents[2] / 'contracts/ai/authoring/v2'

def test_shared_canvas_authoring_fixture_supports_an_empty_caret_without_inventing_evidence():
    request = ContextualRequest.model_validate_json((ROOT / 'model-request.json').read_text())
    saved = AuthoringResult.model_validate_json((ROOT / 'model-result.json').read_text())
    saved.validate_for(request)
    result = ModelGateway(FakeModelProvider()).generate_authoring(request)
    assert result.answer.text == 'Dodaj treść'
    assert result.answer.citation_ids == []
    assert result.template_id == 'canvas-edit:2'

def test_canvas_outer_gateway_never_retries_an_uncertain_paid_provider_action():
    from test_ai import cloud
    from researchhub_worker.ai import authoring
    request = ContextualRequest.model_validate_json((ROOT / 'model-request.json').read_text())
    provider, _ = cloud(b'')
    original = authoring.generate_authoring
    call = Mock(side_effect=ProviderError('AI_UNAVAILABLE', retryable=True))
    authoring.generate_authoring = call
    try:
        with pytest.raises(ProviderError):
            ModelGateway(provider).generate_authoring(request)
        assert call.call_count == 1
    finally:
        authoring.generate_authoring = original

def test_shared_proposal_is_an_immutable_bounded_server_package():
    schema = json.loads((ROOT / 'authoring.schema.json').read_text())
    proposal = json.loads((ROOT / 'proposal.json').read_text())
    assert proposal['schemaVersion'] == '2.0'
    assert proposal['mode'] in schema['$defs']['Proposal']['properties']['mode']['enum']
    assert len(proposal['paragraphs']) <= 16
    assert sum(len(p.encode('utf-16-le')) // 2 for p in proposal['paragraphs']) <= 12000
    assert not {'tools', 'html', 'document', 'code'} & proposal.keys()
    for name in ('accept', 'undo', 'receipt', 'result'):
        assert json.loads((ROOT / f'{name}.json').read_text())
