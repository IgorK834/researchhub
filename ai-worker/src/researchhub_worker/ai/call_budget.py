"""A shared transport admission across fallback, repair and gateway retries."""
from contextlib import contextmanager
from contextvars import ContextVar

_current = ContextVar('contextual_provider_budget', default=None)


@contextmanager
def scope(limit):
    if _current.get() is not None:
        yield
        return
    state = {'remaining': limit, 'calls': 0}
    token = _current.set(state)
    try:
        yield
    finally:
        _current.reset(token)


def admit():
    state = _current.get()
    if state is None:
        return
    if state['remaining'] <= 0:
        from .providers import ProviderError
        raise ProviderError('AI_OUTPUT_INVALID')
    state['remaining'] -= 1
    state['calls'] += 1
