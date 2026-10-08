"""Compatible output validation uses the existing application contracts, not a judge."""
from .context import LocalAnswer
from .contracts import StructuredAnswer


def validate_output(content, name, request):
    if name == 'researchhub_answer_v1':
        StructuredAnswer.model_validate_json(content).validate_evidence(request.evidence)
    elif name == 'researchhub_answer_v2':
        LocalAnswer.model_validate_json(content).to_structured(request.context).validate_evidence(request.request.evidence)
    elif name == 'researchhub_authoring_v1':
        from .authoring import LocalAuthoringAnswer, validate_answer
        validate_answer(LocalAuthoringAnswer.model_validate_json(content), request)
    elif name == 'researchhub_source_analysis_v1':
        from .source_analysis import Answer, instruction, validate_answer
        validate_answer(Answer.model_validate_json(content), instruction(request),
            {binding.citation_key: block.source_id for binding, block in zip(request.context.summary.citations, request.blocks())})
    elif name == 'researchhub_computation_plan_v1':
        from ..analysis.contracts import Plan
        Plan.model_validate_json(content).validate_for(request)
    else:
        raise ValueError('Unknown application output contract')
