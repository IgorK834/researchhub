"""Native Gemini REST policy. Credentials never enter URLs, prompts or exceptions."""
from contextlib import contextmanager
from contextvars import ContextVar
import math
import os
import re
import ssl
import time
from urllib.parse import urlsplit

from .compatible_http import RESPONSE_LIMIT, api_base_url, bearer_key, transient_status

DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta'
DEFAULT_MODEL = 'gemini-3.8-flash'
DEFAULT_VERSION = 'gemini-3.8-flash-ga-native-v2'
DEFAULT_EMBEDDING_MODEL = 'gemini-embedding-001'
# Task type, normalization and dimension participate in the persisted vector-space identity.
DEFAULT_EMBEDDING_VERSION = 'gemini-embedding-001-retrieval-l2-v1'
_deadline = ContextVar('gemini_operation_deadline', default=None)


def setting(name, default):
    return os.getenv(name) or default


def base_url(value):
    validated = api_base_url(value)
    return validated if urlsplit(value).path.rstrip('/') else value.rstrip('/') + '/v1beta'


def model_name(value):
    if not isinstance(value, str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{0,127}', value):
        raise ValueError('Gemini model must be a model ID without a resource prefix')
    return value


def tls_context():
    context = ssl.create_default_context()
    # python.org macOS installations can have an absent OpenSSL CA bundle even
    # though the OS ships a trusted one. Keep certificate/hostname verification
    # enabled and honor explicit SSL_CERT_FILE / SSL_CERT_DIR configuration.
    if not context.get_ca_certs() and not os.getenv('SSL_CERT_FILE') and not os.getenv('SSL_CERT_DIR'):
        for file in ('/etc/ssl/cert.pem', '/etc/ssl/certs/ca-certificates.crt'):
            if os.path.isfile(file):
                context.load_verify_locations(cafile=file)
                break
    return context


def seconds(value, minimum, maximum):
    result = float(value)
    if not math.isfinite(result) or not minimum <= result <= maximum:
        raise ValueError('Invalid Gemini timeout')
    return result


@contextmanager
def operation_scope(budget):
    """One wall-clock budget across transport, fallback, repair and gateway retries."""
    if _deadline.get() is not None:
        yield
        return
    token = _deadline.set(time.monotonic() + budget)
    try:
        yield
    finally:
        _deadline.reset(token)


def remaining_timeout(request_timeout):
    remaining = request_timeout if _deadline.get() is None else _deadline.get() - time.monotonic()
    if remaining <= 0:
        raise TimeoutError('Gemini operation deadline exceeded')
    return min(request_timeout, remaining)


def read_bounded(response, request_timeout):
    """Check the shared deadline between socket reads, also for trickling responses."""
    raw = bytearray()
    read = getattr(response, 'read1', response.read)
    while len(raw) <= RESPONSE_LIMIT:
        remaining_timeout(request_timeout)
        chunk = read(min(16384, RESPONSE_LIMIT + 1 - len(raw)))
        remaining_timeout(request_timeout)
        if not chunk:
            break
        raw.extend(chunk)
    return bytes(raw)


def embedding_batch_size(dimension):
    # Up to 32 bytes per serialized float, plus JSON framing. Keep each vendor
    # response below 256 KiB even for the realistic 768/1536/3072 vector sizes.
    return min(32, max(1, (RESPONSE_LIMIT - 8192) // (dimension * 32)))
