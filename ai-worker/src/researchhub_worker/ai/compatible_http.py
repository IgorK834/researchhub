"""Shared OpenAI-compatible transport policy. Never relax TLS for local/demo use."""
import re
from urllib.parse import urlsplit

RESPONSE_LIMIT = 256 * 1024


def api_base_url(value):
    parts = urlsplit(value)
    # A base can include a vendor API prefix (/v1, /api/v1, /openai/v1).
    # Origins receive the standard /v1 prefix. No userinfo, URL parameters or traversal.
    try:
        port = parts.port
    except ValueError:
        raise ValueError('Invalid compatible API base URL') from None
    path = parts.path.rstrip('/')
    if (parts.scheme != 'https' or not parts.hostname or parts.username is not None
            or parts.password is not None or '?' in value or '#' in value
            or any(c.isspace() for c in value) or '\\' in value or port == 0
            or path and (not re.fullmatch(r'(?:/[A-Za-z0-9._~-]+)+', path)
                         or any(p in {'.', '..'} for p in path.split('/')))):
        raise ValueError('Compatible API base URL must use HTTPS without credentials, query or fragment')
    return value.rstrip('/') + ('' if path else '/v1')


def bearer_key(value):
    if not isinstance(value, str) or not value.strip() or any(c.isspace() for c in value):
        raise ValueError('Compatible API key is required and cannot contain whitespace')
    return value


def transient_status(status):
    return status in (408, 429) or 500 <= status <= 599
