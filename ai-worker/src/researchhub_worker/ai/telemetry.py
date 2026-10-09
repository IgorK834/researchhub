"""Bounded economic metadata across provider validation failures; never prompt/output text."""
from contextvars import ContextVar
from contextlib import nullcontext
from .contracts import ModelMetadata, UsageMetadata

_current: ContextVar[dict | None] = ContextVar('ai_provider_usage', default=None)
_active: ContextVar[bool] = ContextVar('ai_provider_usage_active', default=False)


def record_payload(model, payload, *, accumulate=False):
    """Capture only validated provider usage, before refusal/schema validation."""
    if not _active.get():
        return
    usage = None
    try:
        raw = payload['usage']
        usage = UsageMetadata(input_tokens=raw['prompt_tokens'], output_tokens=raw['completion_tokens'],
                              total_tokens=raw['total_tokens'], estimated=False)
    except (ValueError, KeyError, TypeError):
        pass
    previous = _current.get()
    if accumulate and previous and previous.get('usage') is not None and usage is not None:
        old = UsageMetadata.model_validate(previous['usage'])
        usage = UsageMetadata(input_tokens=old.input_tokens + usage.input_tokens,
            output_tokens=old.output_tokens + usage.output_tokens,
            total_tokens=old.total_tokens + usage.total_tokens, estimated=old.estimated or usage.estimated)
    _current.set({'model': ModelMetadata.model_validate(model.model_dump()).model_dump(mode='json', by_alias=True),
                  'usage': None if usage is None else usage.model_dump(mode='json', by_alias=True)})


def invoke(gateway, operation, command):
    from .providers import ModelGateway, ProviderError
    initial = None
    try:
        initial = {'model': ModelMetadata.model_validate(gateway.model_metadata().model_dump()).model_dump(mode='json', by_alias=True), 'usage': None}
    except Exception:
        pass
    token = _current.set(initial)
    active = _active.set(True)
    try:
        with gateway.operation_scope() if isinstance(gateway, ModelGateway) else nullcontext():
            return operation(command)
    except ProviderError as failure:
        failure.telemetry = _current.get()
        raise
    except Exception:
        failure = ProviderError()
        failure.telemetry = _current.get()
        raise failure from None
    finally:
        _current.reset(token)
        _active.reset(active)


def error_content(failure):
    content = {'code': failure.code}
    if getattr(failure, 'telemetry', None) is not None:
        content['telemetry'] = failure.telemetry
    return content
