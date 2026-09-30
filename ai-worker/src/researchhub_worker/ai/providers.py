"""Provider adapters are the only place that knows cloud inference wire formats."""
from __future__ import annotations

import hashlib
import re
import json
import os
import time
from typing import Protocol
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import Request, build_opener, HTTPRedirectHandler

from .contracts import (ANSWER_SCHEMA, Claim, GenerationRequest, GenerationResult,
                        ModelMetadata, StructuredAnswer, UsageMetadata)
from .context import ContextualRequest, LocalAnswer, LocalClaim, LOCAL_ANSWER_SCHEMA


class ProviderError(RuntimeError):
    def __init__(self, code='AI_PROVIDER_ERROR', retryable=False):
        super().__init__('The model provider could not complete the request')
        self.code = code if code in {'AI_UNAVAILABLE', 'AI_PROVIDER_ERROR', 'AI_OUTPUT_INVALID', 'AI_REFUSED'} else 'AI_PROVIDER_ERROR'
        self.retryable = bool(retryable) and self.code == 'AI_UNAVAILABLE'


class ModelProvider(Protocol):
    def generate_structured(self, request: GenerationRequest | ContextualRequest) -> GenerationResult: ...
    def model_metadata(self) -> ModelMetadata: ...


class FakeModelProvider:
    """Deterministic extractive fixture; never masquerades as a production LLM."""
    def model_metadata(self):
        return ModelMetadata(provider='deterministic', name='extractive-fixture', version='1')

    def generate_structured(self, request):
        contextual = request if isinstance(request, ContextualRequest) else None
        if contextual is not None:
            request = contextual.request
        selected = list(enumerate(request.evidence))
        if request.template_id == 'workspace-question:1':
            # Offline fixture only: quote lexically relevant evidence, never invent an answer.
            # This is intentionally not a semantic entailment classifier or production LLM.
            terms = set(re.findall(r'\w+', request.instruction.casefold())) - {
                'what', 'which', 'who', 'when', 'where', 'why', 'how', 'is', 'are', 'was',
                'were', 'the', 'a', 'an', 'of', 'in', 'on', 'to', 'for', 'and', 'does',
                'do', 'did', 'can', 'you', 'tell', 'me', 'about', 'this', 'that', 'source',
            }
            selected = [(index, item) for index, item in selected
                        if terms & set(re.findall(r'\w+', item.content[:500].casefold()))]
        selected = selected[:4]
        claims = [Claim(text=item.content[:500], evidence_ids=[item.chunk_id]) for _, item in selected]
        answer = StructuredAnswer(status='SUPPORTED' if claims else 'INSUFFICIENT_EVIDENCE', claims=claims)
        if contextual is not None:
            answer = LocalAnswer(status=answer.status, claims=[LocalClaim(text=claim.text,
                citation_keys=[contextual.context.summary.citations[index].citation_key]) for (index, _), claim in zip(selected, claims)]).to_structured(contextual.context)
        input_tokens = (len(request.system_instruction.split()) + len(contextual.user_message().split()) if contextual is not None else
            len(request.system_instruction.split()) + len(request.instruction.split()) + sum(len(item.content.split()) for item in request.evidence))
        output_tokens = len(answer.model_dump_json().split())
        return GenerationResult(schema_version='1.0', request_id=request.request_id,
            template_id=request.template_id, template_hash=request.template_hash,
            model=self.model_metadata(), usage=UsageMetadata(input_tokens=input_tokens, output_tokens=output_tokens,
                total_tokens=input_tokens + output_tokens, estimated=True),
            provider_request_id=hashlib.sha256(answer.model_dump_json().encode()).hexdigest(), answer=answer)


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class FoundryModelProvider:
    """Foundry Azure OpenAI v1 Chat Completions, strict schema, no tools or storage."""
    def __init__(self, endpoint, api_key, deployment, metadata, opener=None):
        parts = urlsplit(endpoint)
        if (parts.scheme != 'https' or not parts.netloc or parts.username or parts.query
                or parts.fragment or parts.path not in ('', '/')):
            raise ValueError('Foundry endpoint must be an HTTPS origin')
        if not api_key or not deployment or metadata.provider != 'foundry':
            raise ValueError('Foundry credentials, deployment and model metadata are required')
        self._url = endpoint.rstrip('/') + '/openai/v1/chat/completions'
        self._api_key, self._deployment, self._metadata = api_key, deployment, metadata
        self._opener = opener or build_opener(_NoRedirect)

    def model_metadata(self):
        return self._metadata

    def generate_structured(self, request):
        contextual = request if isinstance(request, ContextualRequest) else None
        if contextual is not None:
            request = contextual.request
        body = {'model': self._deployment, 'stream': False, 'store': False,
            'messages': [{'role': 'system', 'content': request.system_instruction},
                         {'role': 'user', 'content': contextual.user_message() if contextual is not None else json.dumps({'instruction': request.instruction,
                             'evidence': [item.model_dump(by_alias=True) for item in request.evidence]}, ensure_ascii=False)}],
            'max_completion_tokens': request.parameters.max_output_tokens,
            'response_format': {'type': 'json_schema', 'json_schema': {
                'name': 'researchhub_answer_v2' if contextual is not None else 'researchhub_answer_v1',
                'strict': True, 'schema': LOCAL_ANSWER_SCHEMA if contextual is not None else ANSWER_SCHEMA}}}
        if request.parameters.temperature is not None:
            body['temperature'] = request.parameters.temperature
        http_request = Request(self._url, data=json.dumps(body).encode(), method='POST',
            headers={'Content-Type': 'application/json', 'api-key': self._api_key})
        try:
            with self._opener.open(http_request, timeout=8) as response:
                raw = response.read(256 * 1024 + 1)
            if len(raw) > 256 * 1024:
                raise ValueError('Response too large')
            payload = json.loads(raw)
            if payload['model'] != self._metadata.name or len(payload['choices']) != 1:
                raise ValueError('Model or choices differ from deployment contract')
            choice = payload['choices'][0]
            message = choice['message']
            if message.get('refusal') or choice['finish_reason'] == 'content_filter':
                raise ProviderError('AI_REFUSED')
            if choice['finish_reason'] != 'stop' or message.get('tool_calls') or message.get('function_call'):
                raise ValueError('Incomplete or tool-based answer')
            answer = (LocalAnswer.model_validate_json(message['content']).to_structured(contextual.context) if contextual is not None
                else StructuredAnswer.model_validate_json(message['content']))
            answer.validate_evidence(request.evidence)
            usage = payload['usage']
            result = GenerationResult(schema_version='1.0', request_id=request.request_id,
                template_id=request.template_id, template_hash=request.template_hash, model=self._metadata,
                usage=UsageMetadata(input_tokens=usage['prompt_tokens'], output_tokens=usage['completion_tokens'],
                    total_tokens=usage['total_tokens'], estimated=False), provider_request_id=payload['id'], answer=answer)
            result.validate_for(request)
            return result
        except ProviderError:
            raise
        except HTTPError as error:
            transient = error.code in (408, 429, 500, 502, 503, 504)
            raise ProviderError('AI_UNAVAILABLE' if transient else 'AI_PROVIDER_ERROR', transient) from None
        except (OSError, URLError):
            raise ProviderError('AI_UNAVAILABLE', True) from None
        except (ValueError, KeyError, TypeError, IndexError):
            raise ProviderError('AI_OUTPUT_INVALID') from None


class ModelGateway:
    """All model calls pass through bounded retry and output/identity validation."""
    def __init__(self, provider: ModelProvider, sleep=time.sleep):
        self._provider, self._sleep = provider, sleep

    def model_metadata(self):
        try:
            return ModelMetadata.model_validate(self._provider.model_metadata().model_dump())
        except ProviderError:
            raise
        except (ValueError, TypeError, AttributeError):
            raise ProviderError('AI_OUTPUT_INVALID') from None
        except Exception:
            raise ProviderError('AI_PROVIDER_ERROR') from None

    def generate_structured(self, request):
        # Revalidate typed objects too, before the first provider call (including model_copy inputs).
        if isinstance(request, ContextualRequest):
            try:
                request = ContextualRequest.model_validate(request.model_dump())
            except (ValueError, TypeError):
                raise ProviderError('AI_OUTPUT_INVALID') from None
        core = request.request if isinstance(request, ContextualRequest) else request
        for attempt in range(3):
            try:
                result = self._provider.generate_structured(request)
                result = GenerationResult.model_validate(result.model_dump())
                result.validate_for(core)
                if result.model != self.model_metadata():
                    raise ValueError('Model metadata changed')
                return result
            except ProviderError as failure:
                if not failure.retryable or attempt == 2:
                    raise
                self._sleep(0.2 * 2 ** attempt)
            except (ValueError, TypeError, AttributeError):
                raise ProviderError('AI_OUTPUT_INVALID') from None


def configured_gateway():
    name = os.getenv('AI_WORKER_MODEL_PROVIDER', 'deterministic')
    if name == 'deterministic':
        provider = FakeModelProvider()
    elif name == 'foundry':
        provider = FoundryModelProvider(os.environ['FOUNDRY_ENDPOINT'], os.environ['FOUNDRY_API_KEY'],
            os.environ['FOUNDRY_DEPLOYMENT'], ModelMetadata(provider='foundry', name=os.environ['FOUNDRY_MODEL'],
                version=os.environ['FOUNDRY_MODEL_VERSION']))
    else:
        raise ValueError('Unknown model provider')
    return ModelGateway(provider)
